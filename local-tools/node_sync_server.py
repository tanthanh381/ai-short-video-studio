"""Serves the main Mac's programs and models to the second Mac, which keeps itself identical to it (node_sync_agent.py).

Runs on the main machine under launchd (scripts/air-node/sync-server.sh). Listens on the Tailscale address only, never on
0.0.0.0, and every request needs the node's access code as a Bearer token. Read-only: it lists what belongs to the sync set
(sync_manifest.py) with a sha256 for each file, and sends a file, or the rest of it from a given byte, so a 5 GB model download
that was cut can go on where it stopped. Standard library only.
"""

import argparse
import hmac
import ipaddress
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import sync_manifest

PORT = 8898
REFRESH_S = 30
CHUNK = 1024 * 1024


def env_value(env_text, key):
    """The value of KEY=value in an env file (quotes stripped); empty when missing."""
    line = next((l for l in env_text.splitlines() if l.startswith(f"{key}=")), "")
    return line.split("=", 1)[1].strip().strip("'\"") if line else ""


TAILSCALE_NET = ipaddress.ip_network("100.64.0.0/10")  # the range Tailscale hands out


def valid_tailscale_ip(text):
    """The text as a Tailscale address, or None (the CLI sometimes prints an error and still exits 0)."""
    try:
        address = ipaddress.ip_address((text or "").split()[0])
    except (ValueError, IndexError):
        return None
    return str(address) if address in TAILSCALE_NET else None


def tailscale_ip_from_ifconfig(text):
    """The first address in Tailscale's range found in `ifconfig` output: works where the CLI cannot start (under launchd)."""
    for match in re.finditer(r"\binet (\d+\.\d+\.\d+\.\d+)", text or ""):
        found = valid_tailscale_ip(match.group(1))
        if found:
            return found
    return None


def find_tailscale():
    for candidate in ("tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"):
        try:
            out = subprocess.run([candidate, "ip", "-4"], capture_output=True, text=True, timeout=5)
            found = valid_tailscale_ip(out.stdout) if out.returncode == 0 else None
            if found:
                return found
        except (OSError, subprocess.SubprocessError):
            continue
    try:
        return tailscale_ip_from_ifconfig(subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=5).stdout)
    except (OSError, subprocess.SubprocessError):
        return None


def ollama_models(url):
    """The Ollama models installed here: name, digest, size. Empty when Ollama does not answer."""
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/tags", timeout=4) as reply:
            body = json.load(reply)
        return [{"name": m["name"], "digest": m.get("digest", ""), "size": m.get("size", 0)} for m in body.get("models", []) if m.get("name")]
    except (OSError, ValueError):
        return []


class Source:
    """The manifest of this machine, rebuilt every few seconds (the hash cache makes a rebuild read only what changed)."""

    def __init__(self, roots, ollama_url, cache_path=None):
        self.roots = roots
        self.ollama_url = ollama_url
        self.cache = sync_manifest.HashCache(cache_path)
        self.lock = threading.Lock()
        self.value = None

    def refresh(self):
        entries = sync_manifest.scan(self.roots, True, self.cache)
        files = [e for e in entries.values() if e["kind"] == "file"]
        value = {
            "version": sync_manifest.version_of(entries),
            "generatedAt": time.time(),
            "entries": entries,
            "ollama": ollama_models(self.ollama_url),
            "counts": {"files": len(files), "bytes": sum(e["size"] for e in files)},
        }
        with self.lock:
            self.value = value
        return value

    def current(self):
        with self.lock:
            value = self.value
        return value or self.refresh()


def make_handler(source, token, quiet=False):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            if not quiet:
                print(f"[node-sync] {format % args}", flush=True)

        def send_json(self, status, value):
            data = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            supplied = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            return bool(supplied) and hmac.compare_digest(supplied.encode(), token.encode())

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            if not self.allowed():
                return self.send_json(401, {"error": "unauthorized"})
            if parsed.path == "/manifest":
                value = source.current()
                if query.get("brief", ["0"])[0] == "1":
                    return self.send_json(200, {"version": value["version"], "generatedAt": value["generatedAt"], "counts": value["counts"]})
                return self.send_json(200, value)
            if parsed.path == "/file":
                return self.send_file(query.get("key", [""])[0])
            self.send_json(404, {"error": "not found"})

        def send_file(self, key):
            entry = source.current()["entries"].get(key)
            if not entry or entry["kind"] != "file":
                return self.send_json(404, {"error": "unknown file"})
            path = sync_manifest.resolve(source.roots, key)
            if path is None or not os.path.isfile(path):
                return self.send_json(404, {"error": "unknown file"})
            size = os.path.getsize(path)
            start, end = 0, size - 1
            match = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
            partial = bool(match)
            if match:
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else size - 1
                elif match.group(2):
                    start = max(0, size - int(match.group(2)))
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                end = min(end, size - 1)
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            try:
                with open(path, "rb") as handle:
                    handle.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = handle.read(min(CHUNK, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    return Handler


def serve(source, host, port, token, interval_s=REFRESH_S, quiet=False):
    """Starts the server and the refresh thread; returns the server (call shutdown() to stop it)."""
    source.refresh()
    server = ThreadingHTTPServer((host, port), make_handler(source, token, quiet))
    stop = threading.Event()

    def refresher():
        while not stop.wait(interval_s):
            try:
                source.refresh()
            except Exception as error:  # a failed scan must not stop the server: the last manifest stays valid
                print(f"[node-sync] refresh failed: {error}", flush=True)

    threading.Thread(target=refresher, daemon=True).start()
    threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True).start()
    original_shutdown = server.shutdown

    def shutdown():
        stop.set()
        original_shutdown()

    server.shutdown = shutdown
    return server


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--local-ai", required=True)
    parser.add_argument("--host", default="tailscale", help="the Tailscale address of this Mac ('tailscale' looks it up); never 0.0.0.0")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--env-file", help="file holding the access code")
    parser.add_argument("--env-key", default="AI_NODES_TOKEN")
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    parser.add_argument("--cache", default=str(Path.home() / ".studio-sync-cache.json"))
    args = parser.parse_args(argv)
    token = os.environ.get("NODE_TOKEN") or (env_value(Path(args.env_file).read_text(), args.env_key) if args.env_file else "")
    if not token:
        sys.exit("Thiếu mã truy cập (AI_NODES_TOKEN): máy chủ đồng bộ không chạy khi chưa có mã")
    host = args.host
    if host == "tailscale":
        host = None
        while not host:  # Tailscale may not be up yet right after the Mac starts
            host = find_tailscale()
            if not host:
                print("[node-sync] chờ Tailscale…", flush=True)
                time.sleep(10)
    if host in ("0.0.0.0", "::", ""):
        sys.exit("Máy chủ đồng bộ chỉ được nghe ở địa chỉ Tailscale, không mở ra mọi mạng")
    roots = {"repo": args.repo, "local_ai": args.local_ai}
    source = Source(roots, args.ollama, args.cache)
    server = serve(source, host, args.port, token)
    print(f"[node-sync] phục vụ http://{host}:{args.port} ({source.current()['counts']['files']} tệp, phiên bản {source.current()['version']})", flush=True)
    threading.Event().wait()
    server.shutdown()


if __name__ == "__main__":
    main()
