"""Local-only media bridge for the self-hosted worker.

It deliberately binds to the local machine and exposes no cloud credentials. The
Docker worker calls this bridge through host.docker.internal.
"""

import json
import os
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = os.getenv("LOCAL_MEDIA_HOST", "0.0.0.0")
PORT = int(os.getenv("LOCAL_MEDIA_PORT", "8765"))
COMFY_URL = os.getenv("COMFY_URL", "http://127.0.0.1:8188")
WHISPER_BIN = os.getenv("WHISPER_BIN", "/opt/homebrew/bin/whisper-cli")
WHISPER_MODEL = os.getenv(
    "WHISPER_MODEL",
    str(Path(__file__).parent.parent / "local-models/whisper/ggml-small.bin"),
)


def json_response(handler, status, value):
    data = json.dumps(value, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def binary_response(handler, content_type, data):
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def comfy_image(prompt):
    client_id = "ai-short-video-studio-local"
    graph = {
        "3": {"class_type": "KSampler", "inputs": {"seed": int(time.time_ns() % 2**31), "steps": 8, "cfg": 7.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "analog-diffusion-1.0.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 768, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{prompt}, cinematic illustration, vertical composition, no text, no logo, no watermark", "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "text, watermark, logo, blurry, low quality, distorted face", "clip": ["4", 1]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ai-short-video-studio", "images": ["8", 0]}},
    }
    request = urllib.request.Request(
        f"{COMFY_URL}/prompt",
        data=json.dumps({"prompt": graph, "client_id": client_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        prompt_id = json.load(response)["prompt_id"]
    for _ in range(240):
        time.sleep(2)
        with urllib.request.urlopen(f"{COMFY_URL}/history/{urllib.parse.quote(prompt_id)}", timeout=30) as response:
            history = json.load(response)
        result = history.get(prompt_id)
        if not result:
            continue
        status = result.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(json.dumps(status, ensure_ascii=False))
        for output in result.get("outputs", {}).values():
            for image in output.get("images", []):
                query = urllib.parse.urlencode(image)
                with urllib.request.urlopen(f"{COMFY_URL}/view?{query}", timeout=60) as image_response:
                    return image_response.read()
    raise TimeoutError("ComfyUI không hoàn thành tạo ảnh trong thời gian cho phép")


def tts(text, voice):
    with tempfile.TemporaryDirectory(prefix="studio-tts-") as workdir:
        source = Path(workdir) / "voice.aiff"
        target = Path(workdir) / "voice.mp3"
        subprocess.run(["say", "-v", voice or "Linh", "-o", str(source), text], check=True, timeout=120)
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-codec:a", "libmp3lame", "-q:a", "4", str(target)], check=True, timeout=120)
        return target.read_bytes()


def transcribe(audio):
    with tempfile.TemporaryDirectory(prefix="studio-whisper-") as workdir:
        source = Path(workdir) / "audio.mp3"
        prefix = Path(workdir) / "result"
        source.write_bytes(audio)
        subprocess.run([WHISPER_BIN, "-m", WHISPER_MODEL, "-f", str(source), "-l", "vi", "-oj", "-ojf", "-of", str(prefix), "--no-prints"], check=True, timeout=600)
        result = json.loads((prefix.with_suffix(".json")).read_text())
        words = []
        for segment in result.get("transcription", []):
            current = None
            for token in segment.get("tokens", []):
                raw_text = str(token.get("text", ""))
                text = raw_text.strip()
                offsets = token.get("offsets", {})
                if not text or text.startswith("[") or offsets.get("to", 0) <= offsets.get("from", 0):
                    continue
                start = offsets["from"] / 1000
                end = offsets["to"] / 1000
                if current and raw_text[:1].isspace():
                    words.append(current)
                    current = None
                if current:
                    current["word"] += text
                    current["end"] = end
                else:
                    current = {"word": text, "start": start, "end": end}
            if current:
                words.append(current)
        if not words:
            raise RuntimeError("Whisper không nhận được timestamp từ audio")
        return words


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"ok": True, "image": True, "tts": True, "transcribe": True})
            return
        json_response(self, 404, {"error": "Không tìm thấy endpoint"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            if self.path == "/image":
                payload = json.loads(body)
                binary_response(self, "image/png", comfy_image(str(payload.get("prompt", ""))))
            elif self.path == "/tts":
                payload = json.loads(body)
                binary_response(self, "audio/mpeg", tts(str(payload.get("text", "")), str(payload.get("voice", "Linh"))))
            elif self.path == "/transcribe":
                json_response(self, 200, {"words": transcribe(body)})
            else:
                json_response(self, 404, {"error": "Không tìm thấy endpoint"})
        except Exception as error:
            json_response(self, 500, {"error": str(error)[:500]})

    def log_message(self, format, *args):
        print(f"[local-media] {format % args}", flush=True)


print(f"Local media server listening on {HOST}:{PORT}", flush=True)
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
