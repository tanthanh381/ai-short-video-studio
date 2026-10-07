#!/usr/bin/env python3
"""
Whiteboard Render Server  —  cổng 8766

GET  /health          → {"ok": true}
POST /render          JSON: {image_b64, annotation, total_ms, fps?}  → video/mp4

Yêu cầu: opencv-python  numpy  av  Pillow
  pip install opencv-python numpy av Pillow
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = int(os.environ.get("WHITEBOARD_PORT", "8766"))
SCRIPT_DIR = Path(__file__).resolve().parent / "whiteboard"
RENDER_SCRIPT = SCRIPT_DIR / "render_stream_whiteboard.py"
HAND_PNG = Path(__file__).resolve().parent / "assets" / "drawing-hand.png"
PYTHON = sys.executable


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: ANN001
        pass  # suppress per-request logs; errors still go to stderr

    def _send(self, code: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, json.dumps({"ok": True, "server": "whiteboard"}).encode())
        else:
            self._send(404, b'{"error":"Not found"}')

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/render":
            self._send(404, b'{"error":"Not found"}')
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            data = json.loads(raw)
            image_b64: str = data["image_b64"]
            annotation: dict = data["annotation"]
            total_ms: int = int(data.get("total_ms", 5000))
            fps: int = int(data.get("fps", 30))
        except Exception as exc:
            self._send(400, str(exc).encode(), "text/plain")
            return

        try:
            image_bytes = base64.b64decode(image_b64)
        except Exception:
            self._send(400, b"image_b64 decode failed", "text/plain")
            return

        with tempfile.TemporaryDirectory(prefix="wb-render-") as tmpdir:
            img_path = os.path.join(tmpdir, "scene.png")
            ann_path = os.path.join(tmpdir, "scene.annotation.json")
            out_path = os.path.join(tmpdir, "output.mp4")

            with open(img_path, "wb") as f:
                f.write(image_bytes)
            with open(ann_path, "w", encoding="utf-8") as f:
                json.dump(annotation, f, ensure_ascii=False)

            cmd = [PYTHON, str(RENDER_SCRIPT), img_path, ann_path, out_path]
            if HAND_PNG.exists():
                cmd.append(str(HAND_PNG))
            cmd += ["--total-ms", str(total_ms), "--fps", str(fps)]

            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=600,
            )

            if result.returncode != 0:
                err = (result.stderr or result.stdout or "unknown error").encode()
                self._send(500, err, "text/plain")
                return

            if not os.path.exists(out_path):
                self._send(500, b"render script did not produce output.mp4", "text/plain")
                return

            with open(out_path, "rb") as f:
                mp4_data = f.read()

        self._send(200, mp4_data, "video/mp4")


if __name__ == "__main__":
    if not RENDER_SCRIPT.exists():
        print(
            f"LỖI: Không tìm thấy render script tại {RENDER_SCRIPT}\n"
            "Hãy chắc chắn thư mục local-tools/whiteboard/ có đủ file.",
            file=sys.stderr,
        )
        sys.exit(1)
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Whiteboard render server: http://127.0.0.1:{PORT}/", flush=True)
    server.serve_forever()
