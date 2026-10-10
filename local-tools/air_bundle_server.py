"""One-time bundle server that sets up the MacBook Air as the studio's second machine, run on the Mac mini (scripts/air-node/serve-bundle.sh).

It serves, only under a secret path and only on the Tailscale address, what scripts/air-node/install-air-node.sh needs: the
installer itself with the node's access code filled in, the code of the repository at HEAD (git archive), and the models as a
tar stream (nothing is written to disk: SDXL-Turbo alone is 6.5 GB). When the Air reports it is done, or after the time limit,
the server stops. Standard library only.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8899
TTL_S = 90 * 60
# Without the picture model: voices, Whisper and faces, about half a gigabyte.
SMALL_MODELS = ["models/whisper", "models/piper", "models/vieneu-v3-turbo", "models/moss-audio-tokenizer-onnx", "models/face", "models/vieneu-cache"]
IMAGE_MODELS = ["models/image"]
PLACEHOLDERS = {"@@BUNDLE_URL@@": "bundle_url", "@@NODE_TOKEN@@": "token", "@@NODE_NAME@@": "name"}


def render_installer(template, bundle_url, token, name):
    """The installer with this bundle's address and the node's access code filled in."""
    text = template
    for placeholder, key in PLACEHOLDERS.items():
        text = text.replace(placeholder, {"bundle_url": bundle_url, "token": token, "name": name}[key])
    return text


def env_value(env_text, key):
    """The value of KEY=value in an env file (quotes stripped); empty when the key is missing or blank."""
    line = next((l for l in env_text.splitlines() if l.startswith(f"{key}=")), "")
    return line.split("=", 1)[1].strip().strip("'\"") if line else ""


class Bundle:
    def __init__(self, repo, local_ai, secret, token, name, bundle_url, ttl_s=TTL_S):
        self.repo = Path(repo)
        self.local_ai = Path(local_ai)
        self.secret = secret
        self.token = token
        self.name = name
        self.bundle_url = bundle_url
        self.deadline = time.time() + ttl_s
        self.done = threading.Event()
        self.reported = {}

    def installer(self):
        template = (self.repo / "scripts/air-node/install-air-node.sh").read_text()
        return render_installer(template, self.bundle_url, self.token, self.name)


def make_handler(bundle):
    prefix = f"/{bundle.secret}/"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            print(f"[air-bundle] {format % args}", flush=True)

        def not_found(self):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def stream(self, command, content_type, cwd=None):
            env = {**os.environ, "COPYFILE_DISABLE": "1"}  # no ._ resource-fork files in the tar
            process = subprocess.Popen(command, stdout=subprocess.PIPE, cwd=cwd, env=env)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            try:
                while True:
                    chunk = process.stdout.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                process.kill()
            finally:
                process.stdout.close()
                process.wait()

        def do_GET(self):
            if time.time() > bundle.deadline or not self.path.startswith(prefix):
                return self.not_found()
            parsed = urllib.parse.urlparse(self.path[len(prefix) - 1:])
            route = parsed.path
            query = urllib.parse.parse_qs(parsed.query)
            if route == "/install.sh":
                data = bundle.installer().encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/x-shellscript; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif route == "/repo.tar.gz":
                self.stream(["git", "-C", str(bundle.repo), "archive", "--format=tar.gz", "HEAD"], "application/gzip")
            elif route == "/models.tar":
                dirs = SMALL_MODELS + (IMAGE_MODELS if query.get("image", ["0"])[0] == "1" else [])
                present = [d for d in dirs if (bundle.local_ai / d).exists()]
                self.stream(["tar", "-cf", "-", "--exclude", ".DS_Store", "-C", str(bundle.local_ai), *present], "application/x-tar")
            else:
                self.not_found()

        def do_POST(self):
            if time.time() > bundle.deadline or not self.path.startswith(prefix):
                return self.not_found()
            parsed = urllib.parse.urlparse(self.path[len(prefix) - 1:])
            if parsed.path != "/done":
                return self.not_found()
            bundle.reported = {key: values[0] for key, values in urllib.parse.parse_qs(parsed.query).items()}
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            bundle.done.set()

    return Handler


def serve(bundle, host, port):
    """Starts the server in a thread and returns it; it stops itself when the node reports in or the time is up."""
    server = ThreadingHTTPServer((host, port), make_handler(bundle))

    def watch():
        while not bundle.done.wait(1.0):
            if time.time() > bundle.deadline:
                break
        server.shutdown()

    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=watch, daemon=True).start()
    return server


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--local-ai", required=True)
    parser.add_argument("--host", required=True, help="the Tailscale address of this Mac: never 0.0.0.0")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--secret", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--name", default="air")
    parser.add_argument("--ttl", type=int, default=TTL_S)
    args = parser.parse_args(argv)
    if args.host in ("0.0.0.0", "::", ""):
        sys.exit("Bundle server chỉ được nghe ở địa chỉ Tailscale, không mở ra mọi mạng")
    base = f"http://{args.host}:{args.port}/{args.secret}"
    bundle = Bundle(args.repo, args.local_ai, args.secret, args.token, args.name, base, args.ttl)
    server = serve(bundle, args.host, args.port)
    print(json.dumps({"installCommand": f"curl -fsSL {base}/install.sh | bash", "expiresInMinutes": args.ttl // 60}), flush=True)
    bundle.done.wait(args.ttl)
    time.sleep(1.5)
    print(f"[air-bundle] stopped; node report: {json.dumps(bundle.reported)}", flush=True)
    server.server_close()


if __name__ == "__main__":
    main()
