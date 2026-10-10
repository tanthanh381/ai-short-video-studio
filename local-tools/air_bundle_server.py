"""One-time bundle server that sets up the MacBook Air as the studio's second machine, run on the Mac mini (scripts/air-node/serve-bundle.sh).

It serves, only under a secret path and only on the Tailscale address, what scripts/air-node/install-air-node.sh needs: the
installer itself with the node's access code filled in, the code of the repository at HEAD (git archive), and the models as a
tar stream (nothing is written to disk: SDXL-Turbo alone is 6.5 GB). When the Air reports it is done, or after the time limit,
the server stops. Standard library only.
"""

import argparse
import hmac
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


# The steps of install-air-node.sh, as the website shows them. The installer reports each one; the server also infers the ones it can
# see by itself (the code and the models are downloaded from here), so a run of an older installer still shows its progress.
STEPS = [
    ("check", "Kiểm tra máy"),
    ("tools", "Công cụ hệ thống (Homebrew, Ollama)"),
    ("code", "Tải mã nguồn từ Mac mini"),
    ("python", "Môi trường Python"),
    ("models", "Tải model từ Mac mini"),
    ("token", "Mã truy cập và model Ollama"),
    ("start", "Bật máy phụ"),
]
STEP_IDS = [step_id for step_id, _ in STEPS]
LINGER_S = 10 * 60  # stays up this long after the Air is done, so the website can show "Xong"


def dir_size(path):
    """Bytes `tar` will send for this folder: every file and folder costs a 512-byte header, file data is padded to 512."""
    total = 512
    for root, dirs, files in os.walk(path):
        total += 512 * len(dirs)
        for name in files:
            try:
                total += 512 + -(-os.path.getsize(os.path.join(root, name)) // 512) * 512
            except OSError:
                pass
    return total


class Bundle:
    def __init__(self, repo, local_ai, secret, token, name, bundle_url, ttl_s=TTL_S, linger_s=LINGER_S):
        self.repo = Path(repo)
        self.local_ai = Path(local_ai)
        self.secret = secret
        self.token = token
        self.name = name
        self.bundle_url = bundle_url
        self.started = time.time()
        self.deadline = self.started + ttl_s
        self.linger_s = linger_s
        self.done = threading.Event()
        self.reported = {}
        self.lock = threading.Lock()
        self.steps = {step_id: {"id": step_id, "name": label, "state": "pending", "detail": "", "at": None} for step_id, label in STEPS}
        self.models = {"sentBytes": 0, "totalBytes": 0}
        self.last_seen = None
        self.finished_at = None

    def installer(self):
        template = (self.repo / "scripts/air-node/install-air-node.sh").read_text()
        return render_installer(template, self.bundle_url, self.token, self.name)

    def touch(self):
        self.last_seen = time.time()

    def set_step(self, step_id, state, detail=""):
        """Records a step the installer reported or the server inferred; a step never goes back from done."""
        if step_id not in self.steps or state not in ("running", "done", "failed"):
            return False
        with self.lock:
            step = self.steps[step_id]
            if step["state"] == "done" and state != "failed":
                return True
            step.update({"state": state, "detail": detail[:300] or step["detail"], "at": time.time()})
            # reaching a step means the ones before it are over (an older installer reports nothing at all)
            if state in ("running", "done"):
                for earlier in STEP_IDS[:STEP_IDS.index(step_id)]:
                    if self.steps[earlier]["state"] in ("pending", "running"):
                        self.steps[earlier].update({"state": "done", "at": self.steps[earlier]["at"] or time.time()})
        return True

    def add_models_bytes(self, count):
        with self.lock:
            self.models["sentBytes"] += count

    def mark_done(self, reported):
        with self.lock:
            self.reported = reported
            self.finished_at = time.time()
            for step in self.steps.values():
                if step["state"] != "failed":
                    step.update({"state": "done", "at": step["at"] or self.finished_at})
        self.done.set()

    def status(self):
        """What the website shows (GET /status): the steps, the model download and whether anything is happening."""
        with self.lock:
            failed = next((step for step in self.steps.values() if step["state"] == "failed"), None)
            return {
                "active": self.finished_at is None and time.time() < self.deadline,
                "finished": self.finished_at is not None,
                "failed": failed["id"] if failed else None,
                "node": self.name,
                "startedAt": self.started,
                "expiresAt": self.deadline,
                "lastSeenAt": self.last_seen,
                "steps": [dict(step) for step in self.steps.values()],
                "models": dict(self.models),
                "report": dict(self.reported),
            }


def make_handler(bundle):
    prefix = f"/{bundle.secret}/"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            print(f"[air-bundle] {format % args}", flush=True)

        def not_found(self):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def send_json(self, status, value):
            data = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def stream(self, command, content_type, on_bytes=None):
            env = {**os.environ, "COPYFILE_DISABLE": "1"}  # no ._ resource-fork files in the tar
            process = subprocess.Popen(command, stdout=subprocess.PIPE, env=env)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            complete = False
            try:
                while True:
                    chunk = process.stdout.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    if on_bytes:
                        on_bytes(len(chunk))
                complete = True
            except (BrokenPipeError, ConnectionResetError):
                process.kill()
            finally:
                process.stdout.close()
                process.wait()
            return complete

        def status_allowed(self):
            """GET /status is for the website (through the worker): it needs the node's access code, not the secret path."""
            supplied = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            return bool(supplied) and hmac.compare_digest(supplied.encode(), bundle.token.encode())

        def do_GET(self):
            if self.path.split("?")[0] == "/status":
                if not self.status_allowed():
                    return self.send_json(401, {"error": "unauthorized"})
                return self.send_json(200, bundle.status())
            if time.time() > bundle.deadline or not self.path.startswith(prefix):
                return self.not_found()
            parsed = urllib.parse.urlparse(self.path[len(prefix) - 1:])
            route = parsed.path
            query = urllib.parse.parse_qs(parsed.query)
            bundle.touch()
            if route == "/install.sh":
                data = bundle.installer().encode()
                bundle.set_step("check", "running", "Máy Air đã mở lệnh cài")
                self.send_response(200)
                self.send_header("Content-Type", "text/x-shellscript; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif route == "/repo.tar.gz":
                bundle.set_step("code", "running", "Đang tải mã nguồn")
                if self.stream(["git", "-C", str(bundle.repo), "archive", "--format=tar.gz", "HEAD"], "application/gzip"):
                    bundle.set_step("code", "done", "Đã tải mã nguồn")
            elif route == "/models.tar":
                dirs = SMALL_MODELS + (IMAGE_MODELS if query.get("image", ["0"])[0] == "1" else [])
                present = [d for d in dirs if (bundle.local_ai / d).exists()]
                with bundle.lock:
                    bundle.models = {"sentBytes": 0, "totalBytes": sum(dir_size(bundle.local_ai / d) for d in present) + 10240}
                bundle.set_step("models", "running", "Đang tải model")
                if self.stream(["tar", "-cf", "-", "--exclude", ".DS_Store", "-C", str(bundle.local_ai), *present], "application/x-tar", bundle.add_models_bytes):
                    bundle.set_step("models", "done", "Đã tải model")
            else:
                self.not_found()

        def do_POST(self):
            if time.time() > bundle.deadline or not self.path.startswith(prefix):
                return self.not_found()
            parsed = urllib.parse.urlparse(self.path[len(prefix) - 1:])
            query = {key: values[0] for key, values in urllib.parse.parse_qs(parsed.query).items()}
            bundle.touch()
            if parsed.path == "/progress":
                known = bundle.set_step(query.get("step", ""), query.get("state", ""), query.get("detail", ""))
                return self.send_json(200 if known else 400, {"ok": known})
            if parsed.path != "/done":
                return self.not_found()
            bundle.mark_done(query)
            self.send_json(200, {"ok": True})

    return Handler


def serve(bundle, host, port):
    """Starts the server in a thread and returns it. It stops by itself when the time is up, or `linger_s` after the Air reported in."""
    server = ThreadingHTTPServer((host, port), make_handler(bundle))

    def watch():
        while True:
            if bundle.done.wait(1.0):
                time.sleep(bundle.linger_s)
                break
            if time.time() > bundle.deadline:
                break
        server.shutdown()

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    threading.Thread(target=watch, daemon=True).start()
    server.serve_thread = thread
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
    parser.add_argument("--linger", type=int, default=LINGER_S)
    args = parser.parse_args(argv)
    if args.host in ("0.0.0.0", "::", ""):
        sys.exit("Bundle server chỉ được nghe ở địa chỉ Tailscale, không mở ra mọi mạng")
    base = f"http://{args.host}:{args.port}/{args.secret}"
    bundle = Bundle(args.repo, args.local_ai, args.secret, args.token, args.name, base, args.ttl, args.linger)
    server = serve(bundle, args.host, args.port)
    print(json.dumps({"installCommand": f"curl -fsSL {base}/install.sh | bash", "expiresInMinutes": args.ttl // 60}), flush=True)
    server.serve_thread.join()
    print(f"[air-bundle] stopped; node report: {json.dumps(bundle.reported)}", flush=True)
    server.server_close()


if __name__ == "__main__":
    main()
