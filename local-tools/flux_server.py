"""Persistent Flux.1 Schnell (mflux/MLX) image server for the local AI toolkit.

Generates higher-quality images than SDXL-Turbo, at ~30-60 s per image on M4.
Run it with the toolkit's venv python (it needs mflux installed):

    pip install mflux
    $LOCAL_AI_ROOT/venv/bin/python local-tools/flux_server.py
"""

import gc
import json
import os
import queue
import threading
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOCAL_AI_ROOT = Path(os.getenv(
    "LOCAL_AI_ROOT",
    str(Path.home() / "Developer" / "local-ai"),
))
os.environ.setdefault("HF_HOME", str(LOCAL_AI_ROOT / "models/flux/hf-cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(LOCAL_AI_ROOT / "models/flux/cache"))

HOST = os.getenv("FLUX_SERVER_HOST", "127.0.0.1")
PORT = int(os.getenv("FLUX_SERVER_PORT", "5003"))
QUANTIZE = int(os.getenv("FLUX_QUANTIZE", "4"))
STEPS = int(os.getenv("FLUX_STEPS", "4"))

LOCK = threading.Lock()
STATE = {"flux": None, "error": None, "unloaded": False}
UNLOAD = object()
JOBS = queue.Queue()

IMAGE_SIZES = {
    "9:16": (576, 1024),
    "1:1": (768, 768),
    "16:9": (1024, 576),
    "16:10": (832, 512),
}
PRESETS = {
    "fast": {"steps": 2},
    "balanced": {"steps": 4},
    "quality": {"steps": 6},
}


def load_model():
    import mlx.core as mx
    from mflux import Flux1

    flux = Flux1.from_name("schnell", quantize=QUANTIZE)
    mx.set_cache_limit(int(os.getenv("FLUX_CACHE_LIMIT_MB", "768")) * 1024 * 1024)
    return flux


def model_thread():
    try:
        flux = load_model()
    except Exception as error:
        STATE["error"] = str(error)
        print(f"[flux] failed to load model: {error}", flush=True)
        return
    STATE["flux"] = flux
    print(f"[flux] Flux.1 Schnell Q{QUANTIZE} loaded, serving on {HOST}:{PORT}", flush=True)

    while True:
        job = JOBS.get()
        if job is UNLOAD:
            STATE["flux"] = None
            STATE["unloaded"] = True
            del flux
            gc.collect()
            try:
                import mlx.core as mx
                mx.metal.clear_cache()
            except Exception:
                pass
            print("[flux] model unloaded", flush=True)
            break
        future, prompt, width, height, seed, steps = job
        try:
            import tempfile
            image = flux.generate_image(
                seed=seed, prompt=prompt,
                num_inference_steps=steps, height=height, width=width,
            )
            with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
                image.save(tmp.name)
                future.set_result(Path(tmp.name).read_bytes())
        except Exception as error:
            future.set_exception(error)


def generate(prompt, aspect_ratio, seed, preset):
    if STATE["flux"] is None:
        if STATE["error"]:
            raise RuntimeError(f"Flux model failed to load: {STATE['error']}")
        if STATE["unloaded"]:
            raise RuntimeError("Flux model đã unload")
        raise RuntimeError("Flux model đang tải, thử lại sau")
    width, height = IMAGE_SIZES.get(aspect_ratio, IMAGE_SIZES["9:16"])
    steps = PRESETS.get(preset, PRESETS["balanced"])["steps"]
    future = Future()
    JOBS.put((future, prompt, width, height, seed, steps))
    return future.result(timeout=900)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            if STATE["flux"] is not None:
                self._json(200, {"status": "ready", "model": "flux.1-schnell",
                                 "quantize": QUANTIZE, "steps": STEPS})
            elif STATE["error"]:
                self._json(503, {"status": "error", "error": STATE["error"]})
            else:
                self._json(503, {"status": "loading"})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/unload":
            JOBS.put(UNLOAD)
            self._json(200, {"ok": True})
            return
        if self.path == "/generate":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length))
                prompt = str(body.get("prompt", "")).strip()
                if not prompt:
                    raise ValueError("prompt is required")
                aspect = body.get("aspectRatio", "9:16")
                seed = int(body.get("seed") or 0) % (2 ** 31)
                preset = body.get("preset", "balanced")
                data = generate(prompt, aspect, seed, preset)
                if not data.startswith(b"\x89PNG"):
                    raise RuntimeError("generated image is not valid PNG")
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except ValueError as error:
                self._json(400, {"error": str(error)[:200]})
            except Exception as error:
                self._json(500, {"error": str(error)[:200]})
            return
        self._json(404, {"error": "not found"})

    def _json(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def log_message(self, fmt, *args):
        print(f"[flux] {fmt % args}", flush=True)


if __name__ == "__main__":
    worker = threading.Thread(target=model_thread, daemon=True)
    worker.start()
    print(f"Flux.1 Schnell server starting on {HOST}:{PORT} (Q{QUANTIZE}, {STEPS} steps)", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
