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
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = os.getenv("LOCAL_MEDIA_HOST", "127.0.0.1")
PORT = int(os.getenv("LOCAL_MEDIA_PORT", "8765"))
LOCAL_AI_ROOT = Path(os.getenv(
    "LOCAL_AI_ROOT",
    str(Path.home() / "Developer" / "local-ai"),
))
IMAGE_SCRIPT = Path(os.getenv("IMAGE_SCRIPT", str(LOCAL_AI_ROOT / "bin/generate-image.sh")))
IMAGE_SERVER_URL = os.getenv("IMAGE_SERVER_URL", "http://127.0.0.1:5002")
IMAGE_TIMEOUT_S = int(os.getenv("IMAGE_TIMEOUT_S", "900"))
WHISPER_URL = os.getenv("WHISPER_URL", "http://127.0.0.1:8080")
VIENEU_URL = os.getenv("VIENEU_URL", "http://127.0.0.1:5001")
PIPER_URL = os.getenv("PIPER_URL", "http://127.0.0.1:5000")
VIENEU_VOICE = os.getenv("VIENEU_VOICE", "Đức Trí")
# Voice presets selectable on the website. Keep ids in sync with packages/shared/src/voices.ts.
# (VieNeu preset voice, speed). "giong-linh" is the macOS Linh voice.
VOICE_PRESETS = {
    "doc-truyen": ("Đức Trí", 1.0),
    "co-trang": ("Anh Khôi", 0.88),
    "co-trang-nu": ("Mỹ Duyên", 0.9),
    "triet-ly": ("Minh Quân", 0.85),
    "tam-su": ("Trúc Ly", 0.92),
    "tin-tuc": ("Hữu Quân", 1.05),
    "tin-tuc-nu": ("Ái Hân", 1.05),
    "thuyet-minh": ("Mạnh Dũng", 1.0),
    "nang-dong": ("Xuân Tiên", 1.12),
}
# Ordered preference; the macOS "say" Linh voice is the last-resort fallback.
TTS_ENGINES = [e for e in os.getenv("TTS_ENGINES", "vieneu,piper,say").split(",") if e]
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", str(LOCAL_AI_ROOT / "models/whisper/ggml-base.bin"))
# Image models the toolkit has installed (id -> label). image_server.py serves them.
IMAGE_MODELS = {"sdxl-turbo": "SDXL-Turbo (MLX, nhanh)"}
TTS_ENGINE_LABELS = {"vieneu": "VieNeu (giọng theo thể loại)", "piper": "Piper (giọng Việt nhẹ)", "say": "Giọng Linh (macOS)"}
SAMPLE_RATE = 22050
IMAGE_LOCK = threading.Lock()  # one MLX/Metal job at a time on a 16 GB machine


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


def clean_image_prompt(prompt):
    """SDXL's CLIP vocabulary is English: drop the Vietnamese safety suffix and strip any other diacritics."""
    prompt = prompt.replace("Không chữ, không logo, không watermark.", "")
    text = unicodedata.normalize("NFKD", prompt.replace("đ", "d").replace("Đ", "D"))
    text = re.sub(r"\s+", " ", text.encode("ascii", "ignore").decode()).strip(" .,")
    if not text:
        raise ValueError("Mô tả ảnh cần có nội dung tiếng Anh")
    return text


def local_image(prompt, aspect_ratio="9:16", model=None):
    """SDXL-Turbo (MLX, Apple GPU) from the local AI toolkit. The renderer crops to the video frame."""
    if aspect_ratio not in ("9:16", "1:1", "16:9"):
        raise ValueError("Tỷ lệ ảnh không hợp lệ")
    check_choice("ảnh", model, IMAGE_MODELS)
    # Style words first: if the text encoder's 77-token limit forces trimming, the scene detail goes, not "no text".
    styled = f"cinematic illustration, no text, no logo, no watermark, {clean_image_prompt(prompt)}"
    # The server may still be importing/loading the model (minutes). Wait for it rather than loading a
    # second 7 GB copy through the one-shot script, which only runs if the server never comes up.
    deadline, down_since = time.time() + IMAGE_TIMEOUT_S, None
    while True:
        state = image_server_state()
        if state == "ready":
            break
        down_since = (down_since or time.time()) if state == "down" else None
        if (down_since and time.time() - down_since > 180) or time.time() > deadline:
            break
        time.sleep(5)
    if state == "ready":  # model kept loaded in memory: seconds per image
        request = urllib.request.Request(f"{IMAGE_SERVER_URL}/generate", data=json.dumps({"prompt": styled, "model": model}).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=IMAGE_TIMEOUT_S) as response:
            return response.read()
    with IMAGE_LOCK, tempfile.TemporaryDirectory(prefix="studio-image-") as workdir:
        target = Path(workdir) / "image.png"
        subprocess.run(["/bin/zsh", str(IMAGE_SCRIPT), styled, str(target)],
                       check=True, timeout=IMAGE_TIMEOUT_S, capture_output=True)
        return target.read_bytes()


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


def _http_wav(url, payload):
    request = urllib.request.Request(
        f"{url}/v1/audio/speech", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def _to_pcm22050(source):
    """Any audio file -> mono 16-bit PCM at SAMPLE_RATE, so phrases concatenate with exact timing."""
    target = source.with_suffix(".pcm.wav")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
                    "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", str(target)],
                   check=True, timeout=120, capture_output=True)
    return target


def synth_phrase(phrase, workdir, index, voice, engine=None):
    last_error = None
    engines = TTS_ENGINES
    if engine:  # explicit engine chosen on the website; no silent fallback to another voice
        engines = [check_choice("giọng đọc", engine, TTS_ENGINE_LABELS)]
    elif voice == "giong-linh":  # explicit choice of the macOS voice
        engines = ["say"]
    vieneu_voice, vieneu_speed = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0))
    for engine in engines:
        source = Path(workdir) / f"phrase-{index}-{engine}.wav"
        try:
            if engine == "vieneu":
                source.write_bytes(_http_wav(VIENEU_URL, {"input": phrase, "voice": vieneu_voice, "speed": vieneu_speed, "steps": 16}))
            elif engine == "piper":
                source.write_bytes(_http_wav(PIPER_URL, {"input": phrase}))
            elif engine == "say":
                subprocess.run(["say", "-v", "Linh", "-o", str(source), "--file-format=WAVE",
                                f"--data-format=LEI16@{SAMPLE_RATE}", "--", phrase],
                               check=True, timeout=120, capture_output=True)
            else:
                continue
            # "say" already writes mono 16-bit PCM at SAMPLE_RATE; only network engines need converting.
            return source if engine == "say" else _to_pcm22050(source)
        except Exception as error:  # try the next engine
            last_error = error
    raise RuntimeError("Không engine giọng đọc local nào hoạt động") from last_error


def tts_aligned(text, voice, engine=None):
    phrases = split_speech_phrases(text)
    chunks, cues, frames_total = [], [], 0
    sample_rate = SAMPLE_RATE
    with tempfile.TemporaryDirectory(prefix="studio-aligned-") as workdir:
        for index, phrase in enumerate(phrases):
            source = synth_phrase(phrase, workdir, index, voice, engine)
            with wave.open(str(source), "rb") as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (sample_rate, 1, 2):
                    raise RuntimeError("Giọng đọc local trả định dạng audio không hợp lệ")
                frames = audio.getnframes()
                pcm = audio.readframes(frames)
                if frames <= 0 or len(pcm) != frames * 2:
                    raise RuntimeError("Giọng đọc không tạo được âm thanh")
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


def tts(text, voice, engine=None):
    with tempfile.TemporaryDirectory(prefix="studio-tts-") as workdir:
        source = synth_phrase(text, workdir, 0, voice, engine)
        target = Path(workdir) / "voice.mp3"
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-codec:a", "libmp3lame", "-q:a", "4", str(target)], check=True, timeout=120)
        return target.read_bytes()


def transcribe(audio, model=None):
    """whisper.cpp server (word timestamps). Sub-word pieces are merged into whole words."""
    check_choice("Whisper", model, [Path(WHISPER_MODEL).stem])  # the server has exactly one model loaded
    boundary = uuid.uuid4().hex
    fields = {"response_format": "verbose_json", "language": "vi", "temperature": "0"}
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\n'
                  "Content-Type: application/octet-stream\r\n\r\n").encode())
    body = b"".join(parts) + audio + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{WHISPER_URL}/inference", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=600) as response:
        result = json.load(response)
    words = []
    for segment in result.get("segments", []):
        current = None
        for piece in segment.get("words", []):
            raw = str(piece.get("word", ""))
            text = raw.strip()
            start, end = float(piece.get("start", 0)), float(piece.get("end", 0))
            if not text or text.startswith("["):
                continue
            end = max(end, start + 0.01)  # zero-length sub-word pieces still belong to the word
            if current and raw[:1].isspace():
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


def image_server_state():
    """ready = model loaded; loading = server up but model not ready (503); down = not running."""
    try:
        with urllib.request.urlopen(f"{IMAGE_SERVER_URL}/health", timeout=3):
            return "ready"
    except urllib.error.HTTPError:
        return "loading"
    except Exception:
        return "down"


def service_up(url, path="/health"):
    try:
        with urllib.request.urlopen(f"{url}{path}", timeout=3) as response:
            return response.status == 200
    except Exception:
        return False


def model_catalog():
    """What the website can offer per task. Anything not installed/running is left out."""
    tags = []
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3) as response:
            tags = [m["name"] for m in json.load(response).get("models", [])]
    except Exception:
        pass
    default_llm = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    whisper_id = Path(WHISPER_MODEL).stem
    whisper_ready = service_up(WHISPER_URL, "/") and Path(WHISPER_MODEL).is_file()
    available_engines = {"vieneu": service_up(VIENEU_URL), "piper": service_up(PIPER_URL),
                         "say": bool(shutil.which("say"))}
    return {
        "available": True,
        "storyboard": {"models": [{"id": t, "label": t} for t in tags],
                       "default": default_llm if default_llm in tags else (tags[0] if tags else None)},
        "image": {"models": [{"id": i, "label": l} for i, l in IMAGE_MODELS.items()],
                  "default": next(iter(IMAGE_MODELS))},
        "tts": {"models": [{"id": e, "label": TTS_ENGINE_LABELS[e]} for e in TTS_ENGINES
                           if available_engines.get(e)],
                "default": next((e for e in TTS_ENGINES if available_engines.get(e)), None)},
        "transcribe": {"models": [{"id": whisper_id, "label": f"Whisper {whisper_id.replace('ggml-', '')}"}]
                       if whisper_ready else [],
                       "default": whisper_id if whisper_ready else None},
    }


def check_choice(kind, value, allowed):
    """None/empty = default. Anything else must be an installed option."""
    if value in (None, ""):
        return None
    if value not in allowed:
        raise ValueError(f"Model {kind} không khả dụng trên máy: {str(value)[:60]}")
    return value


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            image_ready = image_server_state() != "down" or (IMAGE_SCRIPT.is_file() and (LOCAL_AI_ROOT / "models/image").is_dir())
            engines = {"vieneu": service_up(VIENEU_URL), "piper": service_up(PIPER_URL),
                       "say": bool(shutil.which("say"))}
            tts_ready = any(engines.get(e) for e in TTS_ENGINES)
            transcribe_ready = service_up(WHISPER_URL, "/")
            json_response(self, 200, {"ok": image_ready and tts_ready, "image": image_ready,
                                    "tts": tts_ready, "alignedTts": tts_ready, "ttsEngines": engines,
                                    "transcribe": transcribe_ready})
            return
        if self.path == "/models":
            json_response(self, 200, model_catalog())
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
                binary_response(self, "image/png", local_image(prompt, payload.get("aspectRatio", "9:16"), payload.get("model")))
            elif self.path == "/tts":
                payload = json.loads(body)
                binary_response(self, "audio/mpeg", tts(str(payload.get("text", "")), str(payload.get("voice", "Linh")), payload.get("engine")))
            elif self.path == "/tts-aligned":
                payload = json.loads(body)
                json_response(self, 200, tts_aligned(str(payload.get("text", "")), str(payload.get("voice", "Linh")), payload.get("engine")))
            elif self.path.split("?")[0] == "/transcribe":
                json_response(self, 200, {"words": transcribe(body, urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("model", [None])[0])})
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
