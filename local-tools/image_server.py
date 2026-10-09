"""Persistent SDXL-Turbo (MLX) image server for the local AI toolkit.

Loading SDXL takes minutes on a 16 GB Mac, so the model is loaded once and kept
in memory. Run it with the toolkit's venv python (it has mlx installed):

    $LOCAL_AI_ROOT/venv/bin/python local-tools/image_server.py
"""

import base64
import gc
import io
import json
import math
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
# Four steps is the balanced default for short-video throughput. Set IMAGE_STEPS=6
# or 8 when a slower, cleaner still is more important than turnaround time.
PRESET = os.getenv("IMAGE_PRESET", "balanced")
PRESETS = {"fast": {"steps": 2, "cfg": 1.1}, "balanced": {"steps": 4, "cfg": 1.25}, "quality": {"steps": 8, "cfg": 1.5}}
STEPS = int(os.getenv("IMAGE_STEPS", str(PRESETS.get(PRESET, PRESETS["balanced"])["steps"])))
CFG_WEIGHT = float(os.getenv("IMAGE_CFG_WEIGHT", str(PRESETS.get(PRESET, PRESETS["balanced"])["cfg"])))
NEGATIVE_PROMPT = os.getenv(
    "IMAGE_NEGATIVE_PROMPT",
    "deformed face, asymmetrical face, bad anatomy, malformed hands, extra fingers, fused fingers, missing fingers, "
    "extra limbs, duplicated person, warped body, broken arms, broken legs, unnatural eyes, blurry face, low detail, "
    "cropped head, cut off hands, text, logo, watermark",
)

LOCK = threading.Lock()
STATE = {"sd": None, "error": None, "unloaded": False}
# Queued instead of a prompt: drop the model so SDXL Base (ComfyUI) can use the memory; the next render reloads it.
UNLOAD = object()


JOBS = queue.Queue()


def load_model():
    sd = StableDiffusionXL("stabilityai/sdxl-turbo", float16=True)
    nn.quantize(sd.text_encoder_1, class_predicate=lambda _, m: isinstance(m, nn.Linear))
    nn.quantize(sd.text_encoder_2, class_predicate=lambda _, m: isinstance(m, nn.Linear))
    nn.quantize(sd.unet, group_size=32, bits=8)
    sd.ensure_models_are_loaded()
    # MLX keeps freed GPU buffers cached for reuse; across many 576x1024 renders that grew to 11 GB and
    # pushed the other models into swap. A small cache keeps the speed and the memory bounded.
    mx.set_cache_limit(int(os.getenv("IMAGE_CACHE_LIMIT_MB", "768")) * 1024 * 1024)
    return sd


def model_thread():
    """MLX GPU streams belong to the thread that created them: load the model and run every
    generation in this one thread; HTTP handler threads only submit jobs and wait."""
    try:
        sd = load_model()
        STATE["sd"] = sd
        print("[image] model ready", flush=True)
    except Exception as error:
        STATE["error"] = str(error)
        print(f"[image] load failed: {error}", flush=True)
        return
    while True:
        job = JOBS.get()
        if job is UNLOAD:
            if sd is not None:
                sd = None
                STATE["sd"], STATE["unloaded"] = None, True
                gc.collect()
                mx.clear_cache()
                print("[image] model unloaded to free memory", flush=True)
            continue
        prompt, seed, options, future = job
        try:
            if sd is None:  # unloaded for SDXL Base earlier: reload on demand (about half a minute)
                sd = load_model()
                STATE["sd"], STATE["unloaded"] = sd, False
                print("[image] model reloaded", flush=True)
            future.set_result(render(sd, prompt, seed, **options))
        except Exception as error:  # reported to the waiting request
            future.set_exception(error)
        finally:
            mx.clear_cache()  # release this render's temporary buffers (decode needs several GB at 576x1024)


def ascii_prompt(prompt):
    """The CLIP vocabulary has no Vietnamese letters (KeyError on e.g. 'ữ'); keep only what it can encode."""
    text = unicodedata.normalize("NFKD", prompt.replace("đ", "d").replace("Đ", "D"))
    return re.sub(r"\s+", " ", text.encode("ascii", "ignore").decode()).strip()


CLIP_LIMIT = 77  # position embeddings: BOS + up to 75 tokens + EOS


def fit_clip_tokens(sd, prompt):
    """Keep both SDXL text encoders inside their 77-token position limit."""
    words = prompt.split()
    while words and max(
        len(sd.tokenizer_1.tokenize(" ".join(words))),
        len(sd.tokenizer_2.tokenize(" ".join(words))),
    ) > CLIP_LIMIT:
        words.pop()
    return " ".join(words)


def reference_array(raw, width, height):
    source = Image.open(io.BytesIO(raw)).convert("RGB")
    source = source.resize((width, height), Image.Resampling.LANCZOS)
    return (mx.array(np.array(source)).astype(mx.float32) / 255) * 2 - 1


def render(sd, prompt, seed, steps=None, width=512, height=512, negative_prompt=NEGATIVE_PROMPT, cfg_weight=None,
           reference_image_bytes=None, reference_strength=0.32):
    prompt = fit_clip_tokens(sd, ascii_prompt(prompt))
    negative_prompt = fit_clip_tokens(sd, ascii_prompt(negative_prompt))
    if not prompt:
        raise ValueError("empty prompt")
    latent = (height // 8, width // 8)
    selected_cfg = CFG_WEIGHT if cfg_weight is None else float(cfg_weight)
    selected_cfg = selected_cfg if negative_prompt.strip() else 0.0
    actual_steps = steps or STEPS
    if reference_image_bytes is not None:
        strength = min(0.65, max(0.15, float(reference_strength)))
        # MLX image-to-image internally multiplies num_steps by strength. Keep
        # the effective denoising budget equal to the selected preset.
        reference_steps = max(actual_steps, math.ceil(actual_steps / strength))
        latents = sd.generate_latents_from_image(
            reference_array(reference_image_bytes, width, height),
            prompt,
            n_images=1,
            strength=strength,
            cfg_weight=selected_cfg,
            num_steps=reference_steps,
            negative_text=negative_prompt if selected_cfg > 1 else "",
            seed=seed if seed is not None else random.randrange(2**31),
        )
    else:
        latents = sd.generate_latents(prompt, n_images=1, cfg_weight=selected_cfg, num_steps=actual_steps,
                                      negative_text=negative_prompt if selected_cfg > 1 else "",
                                      latent_size=latent,
                                      seed=seed if seed is not None else random.randrange(2**31))
    for x_t in latents:
        mx.eval(x_t)
    image = sd.decode(x_t)
    mx.eval(image)
    array = (np.array(image[0]) * 255).clip(0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


def generate(prompt, seed=None, **options):
    future = Future()
    JOBS.put((prompt, seed, options, future))
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
            # Unloaded on purpose still counts as ready: the next request reloads the model.
            ready = STATE["sd"] is not None or STATE["unloaded"]
            self._send(200 if ready else 503, "application/json",
                       json.dumps({"ok": ready, "error": STATE["error"]}).encode())
        else:
            self._send(404, "application/json", b"{}")

    def do_POST(self):
        if self.path == "/unload":
            if STATE["sd"] is not None:
                JOBS.put(UNLOAD)
            self._send(202, "application/json", b'{"ok":true}')
            return
        if self.path != "/generate":
            self._send(404, "application/json", b"{}")
            return
        if STATE["sd"] is None and not STATE["unloaded"]:
            self._send(503, "application/json", b'{"error":"model loading"}')
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if body.get("model") not in (None, "", "sdxl-turbo"):
                raise ValueError("unsupported model")
            prompt = str(body.get("prompt", "")).strip()
            if not prompt or len(prompt) > 3000:
                raise ValueError("bad prompt")
            options = {}
            preset = str(body.get("preset") or PRESET)
            preset_options = PRESETS.get(preset, PRESETS["balanced"])
            if body.get("steps") is not None:
                options["steps"] = max(1, min(int(body["steps"]), 8))
            else:
                options["steps"] = preset_options["steps"]
            options["cfg_weight"] = preset_options["cfg"]
            for key in ("width", "height"):
                if body.get(key) is not None:
                    value = int(body[key])
                    if value % 64 or not 384 <= value <= 1024:
                        raise ValueError(f"bad {key}")
                    options[key] = value
            options["negative_prompt"] = str(body.get("negativePrompt", NEGATIVE_PROMPT)).strip()[:1200]
            reference = body.get("referenceImage")
            if reference:
                if not isinstance(reference, str) or len(reference) > 8_000_000:
                    raise ValueError("bad reference image")
                try:
                    raw = base64.b64decode(reference, validate=True)
                    if len(raw) > 6_000_000:
                        raise ValueError("reference image too large")
                    options["reference_image_bytes"] = raw
                except Exception as error:
                    raise ValueError("bad reference image") from error
                if body.get("referenceStrength") is not None:
                    options["reference_strength"] = float(body["referenceStrength"])
            self._send(200, "image/png", generate(prompt, body.get("seed"), **options))
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
