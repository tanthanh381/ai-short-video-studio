"""Optional local LTX-Video 2B Distilled image-to-video runtime.

This process is intentionally separate from ``media_server.py``: LTX has a large
PyTorch/MPS footprint and must never make the existing SDXL/TTS bridge crash.
It refuses to auto-download model files. Configure a local text encoder before
starting it; otherwise /health truthfully reports offline and the app keeps the
still-image fallback.
"""

import base64
import gc
import json
import os
import subprocess
import sys
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
CPU_FALLBACK = os.getenv("LTX_VIDEO_CPU_FALLBACK", "0").lower() not in {"0", "false", "no"}
TRY_NATIVE_FIRST = os.getenv("LTX_VIDEO_TRY_NATIVE_FIRST", "0").lower() in {"1", "true", "yes"}
ALLOW_LOW_MEMORY = os.getenv("LTX_VIDEO_ALLOW_LOW_MEMORY", "0").lower() in {"1", "true", "yes"}
MIN_MPS_MEMORY_BYTES = int(os.getenv("LTX_VIDEO_MIN_MPS_MEMORY_GB", "24")) * 1024**3
# Runtime is sync-managed so a changed LTX configuration is applied on the secondary Mac after its next sync.
# 0.15 is the upstream default. A small increase makes image-to-video motion visible on short-form shots,
# while the clamp prevents a machine-level environment override from turning into face/anatomy drift.
IMAGE_COND_NOISE_SCALE = max(0.12, min(float(os.getenv("LTX_VIDEO_IMAGE_COND_NOISE_SCALE", "0.18")), 0.24))


def host_memory_bytes():
    """Return physical RAM on macOS; unknown means do not make a memory assumption."""
    if sys.platform != "darwin":
        return None
    try:
        return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        # Health polling clients can disconnect while a response is in flight.
        pass


def binary_response(handler, data):
    handler.send_response(200)
    handler.send_header("Content-Type", "video/mp4")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    try:
        handler.wfile.write(data)
    except BrokenPipeError:
        pass


def runtime_status():
    memory = host_memory_bytes()
    if DEVICE == "mps" and memory is not None and memory < MIN_MPS_MEMORY_BYTES and not ALLOW_LOW_MEMORY:
        return "offline", f"LTX cần ít nhất {MIN_MPS_MEMORY_BYTES // 1024**3} GB RAM khi chạy MPS; máy hiện có {memory // 1024**3} GB"
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


def compact_size(aspect_ratio):
    """A memory-safe fallback that preserves the requested aspect ratio."""
    return {"9:16": (256, 448), "1:1": (384, 384), "16:9": (448, 256)}.get(aspect_ratio, (256, 448))


def is_memory_error(error):
    message = str(error).lower()
    return "out of memory" in message or "mps backend" in message or "allocat" in message and "memory" in message


def clear_accelerator_cache():
    """Release failed-attempt tensors before retrying without taking down the service."""
    gc.collect()
    try:
        import torch
        if hasattr(torch, "mps") and torch.backends.mps.is_available():
            torch.mps.empty_cache()
            torch.mps.synchronize()
    except Exception:
        # Cache cleanup is best-effort; the original inference error remains the source of truth.
        pass


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
    aspect_ratio = payload.get("aspectRatio", "9:16")
    width, height = output_size(aspect_ratio)
    preset = payload.get("preset") if payload.get("preset") in {"fast", "balanced", "quality"} else "balanced"
    frames = {"fast": 25, "balanced": 41, "quality": 65}[preset]
    safe_width, safe_height = compact_size(aspect_ratio)
    safe_frames = {"fast": 17, "balanced": 25, "quality": 33}[preset]
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
        from ltx_video import inference as ltx_inference

        def run_inference(render_width, render_height, render_frames, force_cpu=False):
            original_get_device = ltx_inference.get_device
            if force_cpu:
                ltx_inference.get_device = lambda: "cpu"
            try:
                old = os.getcwd()
                try:
                    os.chdir(str(LTX_ROOT))
                    ltx_inference.infer(ltx_inference.InferenceConfig(
                        prompt=prompt,
                        output_path=output,
                        pipeline_config=str(config_path),
                        seed=seed,
                        height=render_height,
                        width=render_width,
                        num_frames=render_frames,
                        frame_rate=24,
                        negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted, deformed face, extra limbs, flicker",
                        conditioning_media_paths=[str(image)],
                        conditioning_start_frames=[0],
                        image_cond_noise_scale=IMAGE_COND_NOISE_SCALE,
                        offload_to_cpu=False,
                    ))
                finally:
                    os.chdir(old)
            finally:
                ltx_inference.get_device = original_get_device

        if DEVICE == "mps":
            attempts = [(safe_width, safe_height, safe_frames, False, "compact-mps")]
            if TRY_NATIVE_FIRST:
                attempts.insert(0, (width, height, frames, False, "native"))
            if CPU_FALLBACK:
                attempts.append((safe_width, safe_height, min(safe_frames, 17), True, "compact-cpu"))
        else:
            attempts = [(width, height, frames, False, "native")]
        last_error = None
        with GENERATION_LOCK:
            for render_width, render_height, render_frames, force_cpu, label in attempts:
                try:
                    print(f"[ltx] generation attempt={label} size={render_width}x{render_height} frames={render_frames} device={'cpu' if force_cpu else DEVICE}", flush=True)
                    run_inference(render_width, render_height, render_frames, force_cpu)
                    break
                except Exception as error:
                    last_error = error
                    if not is_memory_error(error) or label == attempts[-1][4]:
                        raise
                    print(f"[ltx] memory pressure on attempt={label}; retrying with a safer profile", flush=True)
                    clear_accelerator_cache()
            else:
                raise last_error
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
