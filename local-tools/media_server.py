"""Local-only media bridge for the self-hosted worker.

It deliberately binds to the local machine and exposes no cloud credentials. The
Docker worker calls this bridge through host.docker.internal.
"""

import json
import base64
import io
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = os.getenv("LOCAL_MEDIA_HOST", "127.0.0.1")
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


def comfy_image(prompt, aspect_ratio="9:16"):
    dimensions = {"9:16": (432, 768), "1:1": (640, 640), "16:9": (768, 432)}
    if aspect_ratio not in dimensions:
        raise ValueError("Tỷ lệ ảnh không hợp lệ")
    width, height = dimensions[aspect_ratio]
    client_id = "ai-short-video-studio-local"
    graph = {
        "3": {"class_type": "KSampler", "inputs": {"seed": int(time.time_ns() % 2**31), "steps": 8, "cfg": 7.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "analog-diffusion-1.0.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{prompt}, cinematic illustration, no text, no logo, no watermark", "clip": ["4", 1]}},
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
            raise RuntimeError("ComfyUI không tạo được ảnh; hãy kiểm tra model local")
        for output in result.get("outputs", {}).values():
            for image in output.get("images", []):
                query = urllib.parse.urlencode(image)
                with urllib.request.urlopen(f"{COMFY_URL}/view?{query}", timeout=60) as image_response:
                    return image_response.read()
    raise TimeoutError("ComfyUI không hoàn thành tạo ảnh trong thời gian cho phép")


def split_speech_phrases(text):
    """Original contiguous clauses. Timing is measured after synthesis, never guessed."""
    if not text.strip() or len(text) > 5000:
        raise ValueError("Lời đọc trống hoặc quá dài cho một cảnh")
    phrases, current, count = [], "", 0
    for token in re.findall(r"\S+\s*|\s+", text):
        if len(token) > 240:
            raise ValueError("Lời đọc có một từ quá dài cho phụ đề")
        if current and len(current) + len(token) > 240:
            phrases.append(current)
            current, count = "", 0
        current += token
        count += bool(token.strip())
        if count >= 10 or (count >= 3 and re.search(r"[,;:!?。.][\"'”’)]?\s*$", token)):
            phrases.append(current)
            current, count = "", 0
    if current:
        if not current.strip() and phrases:
            phrases[-1] += current
        else:
            phrases.append(current)
    return phrases


def tts_aligned(text, voice):
    # Only the installed Vietnamese voice; legacy cloud voice names map to Linh.
    voice = "Linh"
    phrases = split_speech_phrases(text)
    chunks, cues, frames_total = [], [], 0
    sample_rate = 22050
    with tempfile.TemporaryDirectory(prefix="studio-aligned-") as workdir:
        for index, phrase in enumerate(phrases):
            source = Path(workdir) / f"phrase-{index}.wav"
            subprocess.run(["say", "-v", voice, "-o", str(source),
                            "--file-format=WAVE", "--data-format=LEI16@22050", "--", phrase],
                           check=True, timeout=120, capture_output=True)
            with wave.open(str(source), "rb") as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (sample_rate, 1, 2):
                    raise RuntimeError("Giọng đọc local trả định dạng audio không hợp lệ")
                frames = audio.getnframes()
                pcm = audio.readframes(frames)
                if frames <= 0 or len(pcm) != frames * 2:
                    raise RuntimeError("Giọng đọc không tạo được âm thanh. Kiểm tra quyền chạy say trên máy")
            start_ms = round(frames_total * 1000 / sample_rate)
            frames_total += frames
            cues.append({"id": str(uuid.uuid4()), "text": phrase,
                         "startMs": start_ms, "endMs": round(frames_total * 1000 / sample_rate)})
            chunks.append(pcm)
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"".join(chunks))
    return {"audioBase64": base64.b64encode(output.getvalue()).decode("ascii"),
            "cues": cues, "durationMs": round(frames_total * 1000 / sample_rate)}


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
            try:
                with urllib.request.urlopen(f"{COMFY_URL}/system_stats", timeout=3) as response:
                    image_ready = response.status == 200
            except Exception:
                image_ready = False
            tts_ready = bool(shutil.which("say"))
            json_response(self, 200, {"ok": image_ready and tts_ready, "image": image_ready,
                                    "tts": tts_ready, "alignedTts": tts_ready,
                                    "transcribe": Path(WHISPER_MODEL).is_file() and Path(WHISPER_BIN).is_file()})
            return
        json_response(self, 404, {"error": "Không tìm thấy endpoint"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 25 * 1024 * 1024:
                json_response(self, 413, {"error": "Dữ liệu trống hoặc vượt giới hạn 25 MB"})
                return
            body = self.rfile.read(length)
            if self.path == "/image":
                payload = json.loads(body)
                prompt = str(payload.get("prompt", ""))
                if not prompt.strip() or len(prompt) > 3000:
                    raise ValueError("Mô tả ảnh trống hoặc quá dài")
                binary_response(self, "image/png", comfy_image(prompt, payload.get("aspectRatio", "9:16")))
            elif self.path == "/tts":
                payload = json.loads(body)
                binary_response(self, "audio/mpeg", tts(str(payload.get("text", "")), str(payload.get("voice", "Linh"))))
            elif self.path == "/tts-aligned":
                payload = json.loads(body)
                json_response(self, 200, tts_aligned(str(payload.get("text", "")), str(payload.get("voice", "Linh"))))
            elif self.path == "/transcribe":
                json_response(self, 200, {"words": transcribe(body)})
            else:
                json_response(self, 404, {"error": "Không tìm thấy endpoint"})
        except ValueError as error:
            json_response(self, 400, {"error": str(error)[:200]})
        except Exception:
            # Never include a subprocess command (which contains the private script).
            json_response(self, 500, {"error": "Không hoàn thành xử lý media local; kiểm tra máy và thử lại"})

    def log_message(self, format, *args):
        print(f"[local-media] {format % args}", flush=True)


if __name__ == "__main__":
    print(f"Local media server listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
