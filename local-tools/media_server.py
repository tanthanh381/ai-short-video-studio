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
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import traceback


HOST = os.getenv("LOCAL_MEDIA_HOST", "127.0.0.1")
# Services are often started from launchers (launchd, IDE agents) whose PATH is only /usr/bin:/bin.
# Make Homebrew tools reachable for this process and every child it spawns.
for _dir in ("/usr/local/bin", "/opt/homebrew/bin"):
    if _dir not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = _dir + os.pathsep + os.environ.get("PATH", "")


def find_binary(name, env_var):
    candidates = [os.getenv(env_var), shutil.which(name), f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}"]
    return next((c for c in candidates if c and os.path.isfile(c) and os.access(c, os.X_OK)), None)


def require_ffmpeg():
    path = find_binary("ffmpeg", "FFMPEG_PATH")
    if not path:
        raise RuntimeError("Thiếu ffmpeg trên máy (brew install ffmpeg hoặc đặt FFMPEG_PATH)")
    return path


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
LTX_VIDEO_URL = os.getenv("LTX_VIDEO_URL", "http://127.0.0.1:8770")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
COMFYUI_CHECKPOINT = os.getenv("COMFYUI_CHECKPOINT", "sd_xl_base_1.0_0.9vae.safetensors")
COMFYUI_MODEL_DIR = Path(os.getenv(
    "COMFYUI_MODEL_DIR",
    str(LOCAL_AI_ROOT / "ComfyUI" / "models" / "checkpoints"),
))
COMFYUI_TIMEOUT_S = int(os.getenv("COMFYUI_TIMEOUT_S", "900"))
# Voice presets selectable on the website. Keep ids in sync with packages/shared/src/voices.ts.
# (VieNeu preset voice, speed).
VOICE_PRESETS = {
    "doc-truyen": ("Đức Trí", 1.0),
    "co-trang": ("Hải Đăng", 0.88),
    "co-trang-nu": ("Mỹ Duyên", 0.9),
    "triet-ly": ("Minh Triết", 0.85),
    "tam-su": ("Trúc Ly", 0.92),
    "tin-tuc": ("Quang Sơn", 1.05),
    "tin-tuc-nu": ("Ngọc Huyền", 1.05),
    "thuyet-minh": ("Phạm Tuyên", 1.0),
    "nang-dong": ("Xuân Vĩnh", 1.12),
}
# Ordered preference for local Vietnamese engines.
TTS_ENGINES = [e for e in os.getenv("TTS_ENGINES", "vieneu,piper").split(",") if e in {"vieneu", "piper"}]
TTS_CONCURRENCY = max(1, min(int(os.getenv("TTS_CONCURRENCY", "2")), 4))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", str(LOCAL_AI_ROOT / "models/whisper/ggml-base.bin"))
# Image models the toolkit has installed (id -> label). image_server.py serves them.
IMAGE_MODELS = {"sdxl-turbo": "SDXL-Turbo (MLX, nhanh)"}
COMFYUI_IMAGE_MODEL = "sdxl-base-1.0-comfyui"
COMFYUI_IMAGE_LABEL = "SDXL Base 1.0 (ComfyUI local)"
TTS_ENGINE_LABELS = {"vieneu": "VieNeu-TTS v3 Turbo (ONNX/CPU)", "piper": "Piper (giọng Việt nhẹ)"}
SAMPLE_RATE = 22050
IMAGE_LOCK = threading.Lock()  # one MLX/Metal job at a time on a 16 GB machine
VIDEO_LOCK = threading.Lock()  # LTX is intentionally single-flight on shared Apple memory
COMFYUI_LOCK = threading.Lock()
VIENEU_LOCK = threading.Lock()  # VieNeu keeps one CPU inference state; parallel requests can corrupt it


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


# Native portrait/landscape sizes (multiples of 64): no square crop, so nothing is cut or upscaled much.
IMAGE_SIZES = {"9:16": (576, 1024), "1:1": (704, 704), "16:9": (1024, 576)}
IMAGE_PRESET = os.getenv("IMAGE_PRESET", "balanced")
IMAGE_PRESETS = {
    "fast": {"steps": 2, "cfg": 1.1},
    "balanced": {"steps": 4, "cfg": 1.25},
    "quality": {"steps": 8, "cfg": 1.5},
}
COMFYUI_IMAGE_PRESETS = {
    "fast": {"steps": 8, "cfg": 5.5},
    "balanced": {"steps": 25, "cfg": 6.5},
    "quality": {"steps": 35, "cfg": 7.0},
}
IMAGE_FACE_PRESET = os.getenv("IMAGE_FACE_PRESET", "quality")
IMAGE_STEPS_OVERRIDE = os.getenv("IMAGE_STEPS")
VIENEU_STEPS = int(os.getenv("VIENEU_STEPS", "16"))
TTS_BREAK_WORDS = int(os.getenv("TTS_BREAK_WORDS", "18"))
# VieNeu-TTS v3 Turbo understands these inline non-verbal cues. They are only
# added to the text sent to the synthesizer; subtitle cues always keep the
# original script verbatim.
EMOTION_TAG_RE = re.compile(r"\[(?:cười|cuoi|thở dài|tho dai|hắng giọng|hang giong)\]", re.IGNORECASE)
EMOTION_MARKERS = {
    "sigh": (
        "mệt", "buồn", "đau", "khóc", "cô đơn", "nuối tiếc", "thất vọng", "tổn thương", "lo lắng",
        "sợ hãi", "chia tay", "mất mát", "im lặng", "nhớ thương", "buông bỏ", "trưởng thành",
        "bình yên", "đôi khi", "nếu hôm nay", "hãy cho phép mình nghỉ",
    ),
    "chuckle": (
        "vui", "hạnh phúc", "yêu đời", "tuyệt vời", "thành công", "chúc mừng", "tự hào", "may mắn",
        "cảm ơn", "chào mừng", "phấn khởi", "rộn ràng", "ưu đãi", "quà tặng", "bất ngờ thú vị",
    ),
    "clear_throat": (
        "quan trọng", "chú ý", "cảnh báo", "đừng", "hãy nhớ", "ngay bây giờ", "sự thật là",
        "điều cần biết", "không được", "bắt buộc", "bí quyết", "lưu ý",
    ),
}
EMOTION_PROFILE = {
    "sigh": {"tag": "[thở dài]", "speed": 0.94},
    "chuckle": {"tag": "[cười]", "speed": 1.04},
    "clear_throat": {"tag": "[hắng giọng]", "speed": 0.98},
}


def normalize_vi_text(text):
    # Keep Vietnamese tone marks: "đau" must not accidentally match "đầu".
    return re.sub(r"\s+", " ", text.lower().replace("đ", "d")).strip()


NORMALIZED_EMOTION_MARKERS = {
    emotion: tuple(normalize_vi_text(marker) for marker in markers)
    for emotion, markers in EMOTION_MARKERS.items()
}
IMAGE_STYLES = {
    "photo": "cinematic photo, realistic textures, sharp focus, soft film lighting",
    "illustration": "cinematic illustration, detailed, soft painterly lighting",
}
IMAGE_ANATOMY_GUARD = os.getenv("IMAGE_ANATOMY_GUARD", "true").lower() not in {"0", "false", "no"}
IMAGE_NEGATIVE_PROMPT = os.getenv(
    "IMAGE_NEGATIVE_PROMPT",
    "deformed face, melted face, asymmetrical face, misaligned eyes, cross-eyed, duplicated facial features, "
    "bad anatomy, malformed hands, extra fingers, fused fingers, missing fingers, "
    "extra limbs, duplicated person, warped body, broken arms, broken legs, unnatural eyes, blurry face, low detail, "
    "cropped head, cut off hands, text, logo, watermark",
)
HUMAN_PROMPT_RE = re.compile(
    r"\b(person|people|human|portrait|woman|man|girl|boy|child|face|hands?|character|"
    r"nguoi|nhan vat|co gai|cau be|be trai|be gai|phu nu|dan ong|khuon mat|ban tay)\b",
    re.I,
)


def comfyui_state():
    """Return the real ComfyUI/checkpoint state; never infer readiness from config alone."""
    if not COMFYUI_MODEL_DIR.joinpath(COMFYUI_CHECKPOINT).is_file():
        return "offline", f"Thiếu checkpoint ComfyUI: {COMFYUI_CHECKPOINT}"
    try:
        with urllib.request.urlopen(f"{COMFYUI_URL.rstrip('/')}/system_stats", timeout=3) as response:
            if response.status == 200:
                return "ready", "ComfyUI và SDXL Base 1.0 đang sẵn sàng"
    except urllib.error.HTTPError as error:
        return "offline", f"ComfyUI trả HTTP {error.code}"
    except Exception:
        pass
    return "offline", "Chưa kết nối ComfyUI local"


def available_image_models():
    models = dict(IMAGE_MODELS)
    state, _ = comfyui_state()
    if state == "ready":
        models[COMFYUI_IMAGE_MODEL] = COMFYUI_IMAGE_LABEL
    return models


def comfyui_image(prompt, negative_prompt, width, height, seed, preset):
    """Run a small, deterministic SDXL txt2img workflow through ComfyUI's local API."""
    selected = preset if preset in COMFYUI_IMAGE_PRESETS else "balanced"
    options = COMFYUI_IMAGE_PRESETS[selected]
    workflow = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": COMFYUI_CHECKPOINT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0],
            "seed": int(seed if seed is not None else uuid.uuid4().int % (2**32)),
            "steps": options["steps"], "cfg": options["cfg"], "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
        }},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ai-short-video-studio", "images": ["6", 0]}},
    }
    request = urllib.request.Request(
        f"{COMFYUI_URL.rstrip('/')}/prompt",
        data=json.dumps({"prompt": workflow, "client_id": "ai-short-video-studio"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        queued = json.load(response)
    prompt_id = queued.get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI không trả prompt_id")
    deadline = time.time() + COMFYUI_TIMEOUT_S
    history = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL.rstrip('/')}/history/{urllib.parse.quote(prompt_id)}", timeout=10) as response:
                history = json.load(response).get(prompt_id)
            if history and history.get("status", {}).get("completed"):
                break
            if history and history.get("status", {}).get("status_str") == "error":
                raise RuntimeError("ComfyUI báo lỗi khi chạy workflow")
        except urllib.error.HTTPError:
            pass
        time.sleep(0.5)
    if not history or not history.get("status", {}).get("completed"):
        raise TimeoutError("ComfyUI tạo ảnh quá thời gian cho phép")
    images = [image for output in history.get("outputs", {}).values() for image in output.get("images", [])]
    if not images:
        raise RuntimeError("ComfyUI hoàn tất nhưng không trả ảnh")
    image = images[0]
    query = urllib.parse.urlencode({"filename": image.get("filename", ""), "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
    with urllib.request.urlopen(f"{COMFYUI_URL.rstrip('/')}/view?{query}", timeout=60) as response:
        data = response.read()
    if not data.startswith(b"\x89PNG"):
        raise RuntimeError("ComfyUI trả dữ liệu ảnh không hợp lệ")
    return data


def local_image(prompt, aspect_ratio="9:16", model=None, seed=None, style="photo", preset=None, reference_image_base64=None):
    """SDXL-Turbo (MLX, Apple GPU) from the local AI toolkit, generated at the video's native aspect."""
    if aspect_ratio not in IMAGE_SIZES:
        raise ValueError("Tỷ lệ ảnh không hợp lệ")
    image_models = available_image_models()
    check_choice("ảnh", model, image_models)
    if style not in IMAGE_STYLES:
        raise ValueError("Phong cách ảnh không hợp lệ")
    if seed is not None:
        seed = int(seed) % (2**31)
    width, height = IMAGE_SIZES[aspect_ratio]
    selected_preset = preset if preset in IMAGE_PRESETS else IMAGE_PRESET
    preset_options = IMAGE_PRESETS.get(selected_preset, IMAGE_PRESETS["balanced"])
    # Style words first: if the text encoder's 77-token limit forces trimming, the scene detail goes, not the style.
    clean = clean_image_prompt(prompt)
    is_human = bool(HUMAN_PROMPT_RE.search(clean))
    anatomy = (
        "one person only, one face, two aligned eyes, symmetrical natural facial features, natural skin texture, "
        "anatomically correct hands, natural body proportions, complete limbs"
        if IMAGE_ANATOMY_GUARD and is_human
        else ""
    )
    anatomy_prefix = f", {anatomy}" if anatomy else ""
    human_detail = ", natural skin, detailed face" if is_human else ""
    nonhuman_focus = "" if is_human else ", the described object or environment is the main subject, no people, no human figures, no face"
    styled = f"{IMAGE_STYLES[style]}{human_detail}{anatomy_prefix}{nonhuman_focus}, {clean}, no text, no logo, no watermark"
    if model == COMFYUI_IMAGE_MODEL:
        if reference_image_base64:
            raise ValueError("SDXL Base qua ComfyUI hiện hỗ trợ text-to-image; hãy bỏ ảnh tham chiếu hoặc chọn SDXL-Turbo")
        with COMFYUI_LOCK:
            return comfyui_image(styled, IMAGE_NEGATIVE_PROMPT if IMAGE_ANATOMY_GUARD else "", width, height, seed, preset)
    # SDXL-Turbo is most likely to deform anatomy at low step counts. Promote
    # every human scene in the balanced preset; explicit fast remains fast.
    if is_human and selected_preset == "balanced" and IMAGE_FACE_PRESET in IMAGE_PRESETS:
        selected_preset = IMAGE_FACE_PRESET
        preset_options = IMAGE_PRESETS[selected_preset]
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
        payload = {"prompt": styled, "model": model, "seed": seed, "steps": int(IMAGE_STEPS_OVERRIDE or preset_options["steps"]), "preset": selected_preset,
                   "width": width, "height": height,
                   "negativePrompt": IMAGE_NEGATIVE_PROMPT if IMAGE_ANATOMY_GUARD else ""}
        if reference_image_base64 and is_human:
            payload["referenceImage"] = reference_image_base64
        request = urllib.request.Request(f"{IMAGE_SERVER_URL}/generate", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=IMAGE_TIMEOUT_S) as response:
            return response.read()
    with IMAGE_LOCK, tempfile.TemporaryDirectory(prefix="studio-image-") as workdir:
        target = Path(workdir) / "image.png"
        subprocess.run(["/bin/zsh", str(IMAGE_SCRIPT), styled, str(target)],
                       check=True, timeout=IMAGE_TIMEOUT_S, capture_output=True)
        return target.read_bytes()


def split_speech_phrases(text):
    """Original contiguous sentences/clauses; timing is measured after synthesis."""
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
        # Keep one sentence per synthesis request whenever possible. This lets
        # VieNeu express each sentence independently instead of flattening a
        # whole paragraph into one prosody pattern.
        if count >= TTS_BREAK_WORDS or (count >= 2 and re.search(r"[.!?…。！？][\"'”’)]?\s*$", token)):
            phrases.append(current)
            current, count = "", 0
    if current:
        if not current.strip() and phrases:
            phrases[-1] += current
        else:
            phrases.append(current)
    return phrases


def emotion_profile(text, voice=""):
    """Infer a conservative speaking cue from Vietnamese words and punctuation.

    This is intentionally deterministic and local-first. It does not rewrite
    the script or claim to understand every emotion; it adds a cue only when a
    strong lexical/voice signal is present. VieNeu maps the three cues to its
    trained emotion tokens.
    """
    if EMOTION_TAG_RE.search(text):
        return None
    normalized = normalize_vi_text(text)
    scores = {
        name: sum(1 for marker in markers if re.search(rf"(?<!\w){re.escape(marker)}(?!\w)", normalized))
        for name, markers in NORMALIZED_EMOTION_MARKERS.items()
    }
    # Voice context is a tie-breaker only; words and punctuation remain the
    # primary signal so a news voice can still sound concerned when the script
    # calls for it.
    if voice in {"tam-su", "triet-ly", "co-trang", "co-trang-nu"} and re.search(r"[.!?…]$", text.strip()):
        scores["sigh"] += int(any(word in normalized for word in ("hay", "nguoi", "cuoc doi", "thoi gian")))
    if voice == "nang-dong" and "!" in text:
        scores["chuckle"] += 1
    if "!" in text and scores["clear_throat"]:
        scores["clear_throat"] += 1
    best, score = max(scores.items(), key=lambda item: item[1])
    return EMOTION_PROFILE[best] if score > 0 else None


def expressive_text(text, voice=""):
    """Return VieNeu markup while leaving the original script untouched elsewhere."""
    profile = emotion_profile(text, voice)
    if not profile:
        return text
    return f"{profile['tag']} {text.lstrip()}"


def _http_wav(url, payload):
    request = urllib.request.Request(
        f"{url}/v1/audio/speech", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def _to_pcm22050(source):
    """Any audio file -> mono 16-bit PCM at SAMPLE_RATE, so phrases concatenate with exact timing."""
    target = source.with_suffix(".pcm.wav")
    subprocess.run([require_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
                    "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", str(target)],
                   check=True, timeout=120, capture_output=True)
    return target


def select_tts_engine(voice, engine=None):
    """Select once per job so a long narration never changes voice halfway through."""
    if engine:
        return check_choice("giọng đọc", engine, TTS_ENGINE_LABELS)
    for candidate in TTS_ENGINES:
        if service_up({"vieneu": VIENEU_URL, "piper": PIPER_URL}.get(candidate, ""), "/health"):
            return candidate
    raise RuntimeError("Không engine giọng đọc local nào sẵn sàng")


def synth_phrase(phrase, workdir, index, voice, engine, speed=1.0):
    vieneu_voice, vieneu_speed = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0))
    requested_speed = max(0.75, min(float(speed), 1.25))
    profile = emotion_profile(phrase, voice) if engine == "vieneu" else None
    if profile:
        vieneu_speed *= profile["speed"]
    vieneu_speed *= requested_speed
    input_text = expressive_text(phrase, voice) if engine == "vieneu" else phrase
    source = Path(workdir) / f"phrase-{index}-{engine}.wav"
    if engine == "vieneu":
        payload = {"input": input_text, "voice": vieneu_voice, "speed": vieneu_speed, "steps": VIENEU_STEPS}
        with VIENEU_LOCK:
            source.write_bytes(_http_wav(VIENEU_URL, payload))
    elif engine == "piper":
        source.write_bytes(_http_wav(PIPER_URL, {"input": input_text}))
    else:
        raise RuntimeError("Engine giọng đọc local không được hỗ trợ")
    return _to_pcm22050(source)


def tts_aligned(text, voice, engine=None):
    phrases = split_speech_phrases(text)
    selected_engine = select_tts_engine(voice, engine)
    chunks, cues, frames_total = [], [], 0
    sample_rate = SAMPLE_RATE
    with tempfile.TemporaryDirectory(prefix="studio-aligned-") as workdir:
        # Phrase synthesis is independent. Keep output order deterministic while
        # overlapping a small, bounded number of local requests.
        with ThreadPoolExecutor(max_workers=min(TTS_CONCURRENCY, len(phrases))) as pool:
            futures = [
                pool.submit(synth_phrase, phrase, workdir, index, voice, selected_engine)
                for index, phrase in enumerate(phrases)
            ]
            sources = [future.result() for future in futures]
        for phrase, source in zip(phrases, sources):
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


def tts(text, voice, engine=None, speed=1.0):
    selected_engine = select_tts_engine(voice, engine)
    with tempfile.TemporaryDirectory(prefix="studio-tts-") as workdir:
        source = synth_phrase(text, workdir, 0, voice, selected_engine, speed)
        target = Path(workdir) / "voice.mp3"
        subprocess.run([require_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-codec:a", "libmp3lame", "-q:a", "4", str(target)], check=True, timeout=120)
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


def ltx_state():
    """Return the real LTX runtime state; never infer readiness from a feature flag."""
    try:
        with urllib.request.urlopen(f"{LTX_VIDEO_URL.rstrip('/')}/health", timeout=3) as response:
            payload = json.load(response)
            return str(payload.get("state", "ready")), str(payload.get("detail", "LTX runtime đang phản hồi"))
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode())
            return str(payload.get("state", "offline")), str(payload.get("detail", "LTX runtime chưa sẵn sàng"))
        except Exception:
            return "offline", "LTX runtime chưa sẵn sàng"
    except Exception:
        return "offline", "Chưa kết nối LTX runtime"


def local_video(image_base64, prompt, aspect_ratio="9:16", model=None, seed=None, preset=None):
    """Proxy a bounded image-to-video request to the separately installed LTX runtime."""
    check_choice("video", model, {"ltxv-2b-0.9.8-distilled": "LTX-Video 2B Distilled"})
    state, detail = ltx_state()
    if state != "ready":
        raise RuntimeError(detail)
    if not image_base64 or len(image_base64) > 8 * 1024 * 1024:
        raise ValueError("Ảnh tham chiếu LTX trống hoặc vượt giới hạn 8 MB")
    payload = json.dumps({"model": model, "prompt": prompt[:3000], "aspectRatio": aspect_ratio,
                          "seed": seed, "preset": preset, "imageBase64": image_base64}).encode()
    request = urllib.request.Request(f"{LTX_VIDEO_URL.rstrip('/')}/video", data=payload,
                                     headers={"Content-Type": "application/json"})
    with VIDEO_LOCK, urllib.request.urlopen(request, timeout=1800) as response:
        data = response.read()
    if not data.startswith(b"\x00\x00\x00") and not data.startswith(b"RIFF"):
        raise RuntimeError("LTX runtime trả về dữ liệu video không hợp lệ")
    return data


def model_catalog():
    """What the website can offer per task. Anything not installed/running is left out."""
    tags = []
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3) as response:
            tags = [m["name"] for m in json.load(response).get("models", [])]
    except Exception:
        pass
    default_llm = os.getenv("OLLAMA_MODEL", "qwen3.5:4b")
    whisper_id = Path(WHISPER_MODEL).stem
    whisper_ready = service_up(WHISPER_URL, "/") and Path(WHISPER_MODEL).is_file()
    available_engines = {"vieneu": service_up(VIENEU_URL), "piper": service_up(PIPER_URL),
                         }
    ltx_ready, _ = ltx_state()
    return {
        "available": True,
        "storyboard": {"models": [{"id": t, "label": t} for t in tags],
                       "default": default_llm if default_llm in tags else (tags[0] if tags else None)},
        "image": {"models": [{"id": i, "label": l} for i, l in available_image_models().items()],
                  "default": next(iter(available_image_models()))},
        "tts": {"models": [{"id": e, "label": TTS_ENGINE_LABELS[e]} for e in TTS_ENGINES
                           if available_engines.get(e)],
                "default": next((e for e in TTS_ENGINES if available_engines.get(e)), None)},
        "transcribe": {"models": [{"id": whisper_id, "label": f"Whisper {whisper_id.replace('ggml-', '')}"}]
                       if whisper_ready else [],
                       "default": whisper_id if whisper_ready else None},
        "video": {"models": [{"id": "ltxv-2b-0.9.8-distilled", "label": "LTX-Video 2B Distilled (I2V)"}]
                  if ltx_ready == "ready" else [],
                  "default": "ltxv-2b-0.9.8-distilled" if ltx_ready == "ready" else None},
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
            comfy_ready, _ = comfyui_state()
            image_ready = image_server_state() != "down" or comfy_ready == "ready" or (IMAGE_SCRIPT.is_file() and (LOCAL_AI_ROOT / "models/image").is_dir())
            engines = {"vieneu": service_up(VIENEU_URL), "piper": service_up(PIPER_URL)}
            ffmpeg_ready = find_binary("ffmpeg", "FFMPEG_PATH") is not None
            tts_ready = ffmpeg_ready and any(engines.get(e) for e in TTS_ENGINES)
            transcribe_ready = service_up(WHISPER_URL, "/")
            ltx_ready, ltx_detail = ltx_state()
            comfy_ready, comfy_detail = comfyui_state()
            ollama_ready = service_up(OLLAMA_URL, "/api/tags")
            json_response(self, 200, {"ok": image_ready and tts_ready, "image": image_ready,
                                    "tts": tts_ready, "alignedTts": tts_ready, "ttsEngines": engines, "ffmpeg": ffmpeg_ready,
                                    "transcribe": transcribe_ready, "ollama": ollama_ready,
                                    "comfyui": comfy_ready == "ready", "comfyuiState": comfy_ready,
                                    "comfyuiDetail": comfy_detail, "video": ltx_ready == "ready",
                                    "videoState": ltx_ready, "videoDetail": ltx_detail})
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
                binary_response(self, "image/png", local_image(prompt, payload.get("aspectRatio", "9:16"), payload.get("model"),
                                                              payload.get("seed"), payload.get("style") or "photo", payload.get("preset"),
                                                              payload.get("referenceImage")))
            elif self.path == "/video":
                payload = json.loads(body)
                binary_response(self, "video/mp4", local_video(
                    str(payload.get("imageBase64", "")), str(payload.get("prompt", "")),
                    payload.get("aspectRatio", "9:16"), payload.get("model"),
                    payload.get("seed"), payload.get("preset")))
            elif self.path == "/tts":
                payload = json.loads(body)
                binary_response(self, "audio/mpeg", tts(str(payload.get("text", "")), str(payload.get("voice", "doc-truyen")), payload.get("engine"), payload.get("speed", 1.0)))
            elif self.path == "/tts-aligned":
                payload = json.loads(body)
                json_response(self, 200, tts_aligned(str(payload.get("text", "")), str(payload.get("voice", "doc-truyen")), payload.get("engine")))
            elif self.path.split("?")[0] == "/transcribe":
                json_response(self, 200, {"words": transcribe(body, urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("model", [None])[0])})
            else:
                json_response(self, 404, {"error": "Không tìm thấy endpoint"})
        except ValueError as error:
            json_response(self, 400, {"error": str(error)[:200]})
        except Exception:
            traceback.print_exc()  # the real cause goes to the service log, never to the client
            # Never include a subprocess command (which contains the private script).
            json_response(self, 500, {"error": "Không hoàn thành xử lý media local; kiểm tra máy và thử lại"})

    def log_message(self, format, *args):
        print(f"[local-media] {format % args}", flush=True)


if __name__ == "__main__":
    print(f"Local media server listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
