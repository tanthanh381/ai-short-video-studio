"""Persistent SDXL-Turbo (MLX) image server for the local AI toolkit.

Loading SDXL takes minutes on a 16 GB Mac, so the model is loaded once and kept
in memory. Run it with the toolkit's venv python (it has mlx installed):

    $LOCAL_AI_ROOT/venv/bin/python local-tools/image_server.py
"""

import io
import json
import queue
import os
import random
import re
import sys
import unicodedata
import threading
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOCAL_AI_ROOT = Path(os.getenv(
    "LOCAL_AI_ROOT",
    str(Path.home() / "Developer" / "local-ai"),
))
os.environ.setdefault("HF_HOME", str(LOCAL_AI_ROOT / "models/image/hf-cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(LOCAL_AI_ROOT / "models/image/cache"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, str(LOCAL_AI_ROOT / "mlx-examples/stable_diffusion"))

import mlx.core as mx  # noqa: E402
import mlx.nn as nn  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from stable_diffusion import StableDiffusionXL  # noqa: E402

HOST = os.getenv("IMAGE_SERVER_HOST", "127.0.0.1")
PORT = int(os.getenv("IMAGE_SERVER_PORT", "5002"))
STEPS = int(os.getenv("IMAGE_STEPS", "2"))

LOCK = threading.Lock()
STATE = {"sd": None, "error": None}


JOBS = queue.Queue()


def model_thread():
    """MLX GPU streams belong to the thread that created them: load the model and run every
    generation in this one thread; HTTP handler threads only submit jobs and wait."""
    try:
        sd = StableDiffusionXL("stabilityai/sdxl-turbo", float16=True)
        nn.quantize(sd.text_encoder_1, class_predicate=lambda _, m: isinstance(m, nn.Linear))
        nn.quantize(sd.text_encoder_2, class_predicate=lambda _, m: isinstance(m, nn.Linear))
        nn.quantize(sd.unet, group_size=32, bits=8)
        sd.ensure_models_are_loaded()
        STATE["sd"] = sd
        print("[image] model ready", flush=True)
    except Exception as error:
        STATE["error"] = str(error)
        print(f"[image] load failed: {error}", flush=True)
        return
    while True:
        prompt, seed, future = JOBS.get()
        try:
            future.set_result(render(sd, prompt, seed))
        except Exception as error:  # reported to the waiting request
            future.set_exception(error)


def ascii_prompt(prompt):
    """The CLIP vocabulary has no Vietnamese letters (KeyError on e.g. 'ữ'); keep only what it can encode."""
    text = unicodedata.normalize("NFKD", prompt.replace("đ", "d").replace("Đ", "D"))
    return re.sub(r"\s+", " ", text.encode("ascii", "ignore").decode()).strip()


CLIP_LIMIT = 77  # position embeddings: BOS + up to 75 tokens + EOS


def fit_clip_tokens(sd, prompt):
    """Longer prompts overflow the text encoder (index error). Drop trailing words until it fits."""
    words = prompt.split()
    while words and len(sd.tokenizer_1.tokenize(" ".join(words))) > CLIP_LIMIT:
        words.pop()
    return " ".join(words)


def render(sd, prompt, seed):
    prompt = fit_clip_tokens(sd, ascii_prompt(prompt))
    if not prompt:
        raise ValueError("empty prompt")
    latents = sd.generate_latents(prompt, n_images=1, cfg_weight=0.0, num_steps=STEPS,
                                  seed=seed if seed is not None else random.randrange(2**31))
    for x_t in latents:
        mx.eval(x_t)
    image = sd.decode(x_t)
    mx.eval(image)
    array = (np.array(image[0]) * 255).clip(0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


def generate(prompt, seed=None):
    future = Future()
    JOBS.put((prompt, seed, future))
    return future.result(timeout=900)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, content_type, data):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            ready = STATE["sd"] is not None
            self._send(200 if ready else 503, "application/json",
                       json.dumps({"ok": ready, "error": STATE["error"]}).encode())
        else:
            self._send(404, "application/json", b"{}")

    def do_POST(self):
        if self.path != "/generate":
            self._send(404, "application/json", b"{}")
            return
        if STATE["sd"] is None:
            self._send(503, "application/json", b'{"error":"model loading"}')
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if body.get("model") not in (None, "", "sdxl-turbo"):
                raise ValueError("unsupported model")
            prompt = str(body.get("prompt", "")).strip()
            if not prompt or len(prompt) > 3000:
                raise ValueError("bad prompt")
            self._send(200, "image/png", generate(prompt, body.get("seed")))
        except ValueError as error:
            print(f"[image] bad request: {error}", flush=True)
            self._send(400, "application/json", b'{"error":"bad request"}')
        except Exception as error:
            print(f"[image] generate failed: {error}", flush=True)
            self._send(500, "application/json", b'{"error":"generate failed"}')

    def log_message(self, format, *args):
        print(f"[image] {format % args}", flush=True)


if __name__ == "__main__":
    threading.Thread(target=model_thread, daemon=True).start()
    print(f"Image server on {HOST}:{PORT} (loading model...)", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
