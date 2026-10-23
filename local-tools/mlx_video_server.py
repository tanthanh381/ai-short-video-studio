#!/usr/bin/env python3
"""MLX Wan2.2 TI2V-5B image-to-video server for the Air node.

Speaks the SAME HTTP contract as ltx_server.py (GET /health, POST /video) so the
existing media_server can drive it on port 8770 with no change. LTX-Video via
PyTorch/MPS crashes or times out on this hardware; the MLX build of Wan2.2 TI2V-5B
runs real image-to-video in ~7 min for a short clip, peaking ~15.6 GB on the 24 GB
Air (measured). Each /video shells out to the proven `mlxgen generate` CLI in the
mlx-gen venv — the model reloads per call, but one short clip stays well under
media_server's 900 s request timeout, and the hybrid pipeline only asks for motion
on the opening scene, so one call per video is enough.
"""
import base64
import json
import os
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.getenv("MLX_VIDEO_HOST", "127.0.0.1")
# Take LTX's port so media_server reaches us unchanged (LTX_VIDEO_URL defaults to :8770).
PORT = int(os.getenv("MLX_VIDEO_PORT", os.getenv("LTX_VIDEO_PORT", "8770")))
WORK = Path(os.getenv("MLX_WORK", str(Path.home() / "mlx-ltx-bench")))
MLXGEN = os.getenv("MLXGEN_BIN", str(WORK / "venv" / "bin" / "mlxgen"))
WAN_MODEL = os.getenv("WAN_MODEL", "AbstractFramework/wan2.2-ti2v-5b-diffusers-8bit")
# media_server forwards the website's video model id ("ltxv-2b-0.9.8-distilled") only as an
# "motion on" flag; we accept any id and always render with the Wan MLX model.
MODEL_ID = os.getenv("MLX_MODEL_ID", "ltxv-2b-0.9.8-distilled")
# Wan keeps the source aspect ratio; these are hints. 9:16 matches the chibi stills.
SIZE = {"9:16": (384, 672), "16:9": (672, 384), "1:1": (512, 512)}
# (frames, steps) per quality preset. Balanced = the measured-good v3 profile.
PRESET = {"fast": (17, 18), "balanced": (21, 28), "quality": (25, 32)}
# Appended to every prompt: the v3 run proved a hard style-lock is what stops Wan from
# repainting the flat chibi art into a smudged painting.
STYLE_LOCK = (
    " Flat 2D hand-drawn illustration, clean bold ink outlines. Keep the EXACT same art style, "
    "line art, colours, face, costume, proportions and background as the input frame — do not "
    "repaint, do not re-shade, do not change the drawing. No style change, no morphing, no "
    "melting, no blur, camera locked and still."
)


def run_generate(image_png: Path, prompt: str, aspect: str, seed: int, preset: str) -> bytes:
    width, height = SIZE.get(aspect, SIZE["9:16"])
    frames, steps = PRESET.get(preset if preset in PRESET else "balanced", PRESET["balanced"])
    out = WORK / f"mlx_out_{os.getpid()}_{int(time.time())}.mp4"
    cmd = [
        MLXGEN, "generate", "--model", WAN_MODEL, "--image", str(image_png),
        "--prompt", (prompt.strip() + STYLE_LOCK)[:3000],
        "--width", str(width), "--height", str(height),
        "--frames", str(frames), "--steps", str(steps),
        "--guidance", "5", "--flow-shift", "3", "--fps", "20", "--seed", str(seed),
        "--low-ram", "--output", str(out),
    ]
    try:
        # Under media_server's 900 s client timeout; give the subprocess a little more headroom.
        subprocess.run(cmd, check=True, timeout=1400, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        data = out.read_bytes()
    finally:
        out.unlink(missing_ok=True)
    return data


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            ready = Path(MLXGEN).exists()
            self._json(200, {
                "ok": ready,
                "state": "ready" if ready else "offline",
                "detail": "MLX Wan2.2 TI2V sẵn sàng" if ready else "Chưa thấy mlxgen trong venv",
                "model": MODEL_ID,
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/video":
            self._json(404, {"error": "not found"})
            return
        img = None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            raw = base64.b64decode(str(payload.get("imageBase64", "")), validate=True)
            if not raw:
                raise ValueError("ảnh tham chiếu trống")
            WORK.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=WORK, suffix=".png", delete=False) as handle:
                handle.write(raw)
                img = Path(handle.name)
            data = run_generate(
                img,
                str(payload.get("prompt", "")),
                payload.get("aspectRatio", "9:16"),
                int(payload.get("seed") or 42),
                str(payload.get("preset") or "balanced"),
            )
            # media_server rejects anything that is not an mp4/avi container.
            if not data.startswith(b"\x00\x00\x00") and not data.startswith(b"RIFF"):
                raise RuntimeError("mlxgen không trả về mp4 hợp lệ")
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as error:  # noqa: BLE001 - report to the caller, keep serving
            self._json(502, {"error": "MLX inference failed", "detail": str(error).replace("\n", " ")[:240]})
        finally:
            if img is not None:
                img.unlink(missing_ok=True)

    def log_message(self, *args):  # keep the console quiet; errors still return over HTTP
        pass


def main():
    ready = Path(MLXGEN).exists()
    print(f"MLX video server on {HOST}:{PORT} | mlxgen={'OK' if ready else 'MISSING ' + MLXGEN} | model={WAN_MODEL}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
