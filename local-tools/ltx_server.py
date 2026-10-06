"""Optional local LTX-Video 2B Distilled image-to-video runtime.

This process is intentionally separate from ``media_server.py``: LTX has a large
PyTorch/MPS footprint and must never make the existing SDXL/TTS bridge crash.
It refuses to auto-download model files. Configure a local text encoder before
starting it; otherwise /health truthfully reports offline and the app keeps the
still-image fallback.
"""

import base64
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.getenv("LTX_VIDEO_HOST", "127.0.0.1")
PORT = int(os.getenv("LTX_VIDEO_PORT", "8770"))
LTX_ROOT = Path(os.getenv("LTX_VIDEO_ROOT", str(Path.home() / "Developer" / "local-ai" / "LTX-Video")))
CHECKPOINT = Path(os.getenv("LTX_VIDEO_CHECKPOINT", str(Path.home() / "Developer" / "local-ai" / "models" / "ltx-video" / "ltxv-2b-0.9.8-distilled.safetensors")))
TEXT_ENCODER = os.getenv("LTX_VIDEO_TEXT_ENCODER", "")
DEVICE = os.getenv("LTX_VIDEO_DEVICE", "mps")
MODEL_ID = "ltxv-2b-0.9.8-distilled"
MAX_BODY = 12 * 1024 * 1024
GENERATION_LOCK = threading.Lock()


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def binary_response(handler, data):
    handler.send_response(200)
    handler.send_header("Content-Type", "video/mp4")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def runtime_status():
    if not CHECKPOINT.is_file():
        return "offline", f"Thiếu checkpoint LTX: {CHECKPOINT}"
    if not TEXT_ENCODER:
        return "offline", "Thiếu LTX text encoder local; không tự tải để tránh đầy ổ đĩa"
    encoder = Path(TEXT_ENCODER)
    if not encoder.is_dir() or not (encoder / "text_encoder").is_dir() or not (encoder / "tokenizer").is_dir():
        return "offline", f"Text encoder LTX chưa đầy đủ: {encoder}"
    try:
        import torch  # noqa: F401
        import ltx_video  # noqa: F401
    except Exception as error:
        return "offline", f"Môi trường LTX chưa sẵn sàng: {type(error).__name__}"
    return "ready", f"LTX-Video 2B Distilled sẵn sàng trên {DEVICE}"


def output_size(aspect_ratio):
    # Keep the native render below the official <720x1280 recommendation.
    return {"9:16": (576, 1024), "1:1": (704, 704), "16:9": (1024, 576)}.get(aspect_ratio, (576, 1024))


def generate(payload):
    state, detail = runtime_status()
    if state != "ready":
        raise RuntimeError(detail)
    if payload.get("model") not in (None, "", MODEL_ID):
        raise ValueError("Model LTX không khả dụng trên máy")
    raw = base64.b64decode(str(payload.get("imageBase64", "")), validate=True)
    if not raw or len(raw) > 8 * 1024 * 1024:
        raise ValueError("Ảnh tham chiếu LTX trống hoặc vượt giới hạn 8 MB")
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt or len(prompt) > 3000:
        raise ValueError("Prompt LTX trống hoặc quá dài")
    width, height = output_size(payload.get("aspectRatio", "9:16"))
    preset = payload.get("preset") if payload.get("preset") in {"fast", "balanced", "quality"} else "balanced"
    frames = {"fast": 25, "balanced": 41, "quality": 65}[preset]
    seed = int(payload.get("seed") or 8703) % (2**31)
    with tempfile.TemporaryDirectory(prefix="studio-ltx-") as directory:
        root = Path(directory)
        image = root / "reference.png"
        image.write_bytes(raw)
        output = root / "output"
        output.mkdir()
        # The official inference entry point keeps model behavior and checkpoint
        # compatibility in one place. A single-flight lock avoids MPS OOMs.
        config_path = root / "ltx-single-scale.yaml"
        config_path.write_text(
            "\n".join([
                "pipeline_type: single-scale",
                f"checkpoint_path: {CHECKPOINT}",
                f"text_encoder_model_name_or_path: {TEXT_ENCODER}",
                "precision: bfloat16",
                "sampler: from_checkpoint",
                'stg_mode: "attention_values"',
                "decode_timestep: 0.05",
                "decode_noise_scale: 0.025",
                "prompt_enhancement_words_threshold: 0",
                "prompt_enhancer_image_caption_model_name_or_path: null",
                "prompt_enhancer_llm_model_name_or_path: null",
                "stochastic_sampling: false",
            ]) + "\n",
            encoding="utf-8",
        )
        from ltx_video.inference import InferenceConfig, infer
        with GENERATION_LOCK:
            old = os.getcwd()
            try:
                os.chdir(str(LTX_ROOT))
                infer(InferenceConfig(
                    prompt=prompt,
                    output_path=output,
                    pipeline_config=str(config_path),
                    seed=seed,
                    height=height,
                    width=width,
                    num_frames=frames,
                    frame_rate=24,
                    negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted, deformed face, extra limbs, flicker",
                    conditioning_media_paths=[str(image)],
                    conditioning_start_frames=[0],
                    image_cond_noise_scale=0.15,
                    offload_to_cpu=False,
                ))
            finally:
                os.chdir(old)
        files = sorted(output.glob("*.mp4"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not files:
            raise RuntimeError("LTX không tạo được file MP4")
        return files[0].read_bytes()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            state, detail = runtime_status()
            json_response(self, 200, {"ok": state == "ready", "state": state, "detail": detail, "model": MODEL_ID})
            return
        json_response(self, 404, {"error": "Không tìm thấy endpoint"})

    def do_POST(self):
        if self.path != "/video":
            json_response(self, 404, {"error": "Không tìm thấy endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("Dữ liệu LTX trống hoặc vượt giới hạn")
            payload = json.loads(self.rfile.read(length))
            binary_response(self, generate(payload))
        except ValueError as error:
            json_response(self, 400, {"error": str(error)[:200]})
        except Exception as error:
            # Keep model paths and subprocess details out of the HTTP response.
            print(f"[ltx] generation failed: {type(error).__name__}: {error}", flush=True)
            json_response(self, 503, {"error": "LTX chưa tạo được video; hệ thống sẽ dùng ảnh tĩnh nếu chưa bật model này"})

    def log_message(self, format, *args):
        print(f"[ltx] {format % args}", flush=True)


if __name__ == "__main__":
    state, detail = runtime_status()
    print(f"LTX server listening on {HOST}:{PORT} ({state}: {detail})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
