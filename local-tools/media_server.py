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
# (VieNeu preset voice, mood, native words/second at speed 1.0).
# Pace is normalised per voice: the voices read at very different natural rates (2.97 w/s for Đức Trí, 4.66 for
# Trúc Ly), so one fixed multiplier made some videos drag and others race (6 w/s). Every voice is stretched to
# PACE_TARGET_WPS × mood × the video's own reading speed; mood keeps genre feel (calmer philosophy, brisker ads).
VOICE_PRESETS = {
    "doc-truyen": ("Đức Trí", 1.0, 2.97),
    "co-trang": ("Hải Đăng", 0.93, 4.51),
    "co-trang-nu": ("Mỹ Duyên", 0.95, 3.10),
    "triet-ly": ("Minh Triết", 0.92, 4.43),
    "tam-su": ("Trúc Ly", 0.95, 4.66),
    "tin-tuc": ("Quang Sơn", 1.05, 3.34),
    "tin-tuc-nu": ("Ngọc Huyền", 1.05, 4.16),
    "thuyet-minh": ("Phạm Tuyên", 1.02, 4.10),
    "nang-dong": ("Xuân Vĩnh", 1.05, 4.30),
}
# Short-form narration lands at 3.3-4.2 words/s; 3.7 is the middle. Measured on finished videos, the gaps between
# phrases make the spoken rate about 4% lower than the raw synthesis rate.
PACE_TARGET_WPS = float(os.getenv("PACE_TARGET_WPS", "3.7"))
PACE_VIDEO_FACTOR = 0.96
PIPER_NATIVE_WPS = 4.31
# Ordered preference for local Vietnamese engines.
TTS_ENGINES = [e for e in os.getenv("TTS_ENGINES", "vieneu,piper").split(",") if e in {"vieneu", "piper"}]
TTS_CONCURRENCY = max(1, min(int(os.getenv("TTS_CONCURRENCY", "2")), 4))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", str(LOCAL_AI_ROOT / "models/whisper/ggml-base.bin"))
# Image models the toolkit has installed (id -> label). image_server.py serves them.
IMAGE_MODELS = {"sdxl-turbo": "SDXL-Turbo — nhanh (~15–25 giây/ảnh)"}
COMFYUI_IMAGE_MODEL = "sdxl-base-1.0-comfyui"
COMFYUI_IMAGE_LABEL = "SDXL Base 1.0 — đẹp hơn, ít người thừa, chậm (~1–1,5 phút/ảnh)"
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
    text = text.encode("ascii", "ignore").decode()
    # SDXL paints gibberish ("CLOSED CE") on anything that implies lettering; the picture reads better without it.
    text = re.sub(r"\b(?:signs?|signboards?|billboards?|banners?|posters?|newspapers?|neon|lettering)\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bclosed\b", "quiet", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" .,")
    if not text:
        raise ValueError("Mô tả ảnh cần có nội dung tiếng Anh")
    return text


# Native portrait/landscape sizes (multiples of 64): no square crop, so nothing is cut or upscaled much.
IMAGE_SIZES = {"9:16": (576, 1024), "1:1": (704, 704), "16:9": (1024, 576), "16:10": (1024, 640)}
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
IMAGE_PERSON_STEPS = max(2, min(int(os.getenv("IMAGE_PERSON_STEPS", "6")), 8))
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
    # Picture-book look used by story-card videos; kept short so the 77-token limit does not trim the scene.
    "flat": "flat 2D vector illustration, picture book, bold outlines, muted warm colors, cartoon",
    # One entry per visual preset of the website. The style words lead the prompt: SDXL reads only the first 77
    # tokens, so a style placed after the scene text is silently dropped and every preset looks the same.
    "historical": "cinematic historical period photo, traditional clothing, ancient architecture, warm lantern light",
    "ink": "ink pen line drawing, bold black outlines, crosshatch shading, off-white paper, monochrome sketch, no color",
    "watercolor": "delicate watercolor painting, soft bleeding washes, visible paper grain, pastel palette",
    "paper-cut": "layered paper-cut art, colored paper shapes, clean silhouettes, soft cast shadows",
    # Drawn by the hand renderer: it inks the dark outlines first, then washes in the flat colours. Photos have no
    # outlines to follow (sparse specks, then white holes where the background matched the paper), so this look only.
    "whiteboard": "whiteboard doodle illustration, bold black marker outlines, flat pastel colors, plain white background",
}
# Drawn looks: photo skin/anatomy wording would pull them back towards photographs.
STYLIZED_IMAGE_STYLES = {"flat", "ink", "watercolor", "paper-cut", "whiteboard"}
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


# Only one image model fits next to the rest of the stack on a 16 GB Mac: SDXL Base (ComfyUI) and SDXL-Turbo
# (MLX) each take several GB. Using one asks the other to release its memory; the released one reloads on demand.
IMAGE_ENGINE = {"comfy_used": False}


def release_turbo_model():
    try:
        request = urllib.request.Request(f"{IMAGE_SERVER_URL}/unload", data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5):
            pass
    except Exception:
        pass  # best effort: generation still works, only with less free memory


def release_comfy_model():
    if not IMAGE_ENGINE["comfy_used"]:
        return
    try:
        body = json.dumps({"unload_models": True, "free_memory": True}).encode()
        request = urllib.request.Request(f"{COMFYUI_URL.rstrip('/')}/free", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10):
            pass
        IMAGE_ENGINE["comfy_used"] = False
    except Exception:
        pass


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


# Faces are redrawn larger after generation (local-tools/face_detail.py, YuNet + image-to-image): SDXL-Turbo smeared
# eyes and bent glasses on faces of ~100 px. Runs in the whiteboard venv, which has OpenCV; any failure keeps the image.
FACE_DETAIL = os.getenv("FACE_DETAIL", "true").lower() not in {"0", "false", "no"}
FACE_PYTHON = os.getenv("FACE_DETAIL_PYTHON", str(Path.home() / "Developer/local-ai/wb-venv/bin/python"))
FACE_SCRIPT = Path(__file__).resolve().parent / "face_detail.py"
# Who may have a face worth redrawing. Wider than HUMAN_PROMPT_RE ("two elderly friends", "a mother"), and still a gate:
# a redraw prompted as a person would put a human face on a cat or a clock that YuNet happened to score high.
FACE_SUBJECT_RE = re.compile(
    r"\b(?:person|people|human|portrait|face|wom[ae]n|m[ae]n|girls?|boys?|child(?:ren)?|kids?|baby|mother|father|parents?|"
    r"family|couple|friends?|elderly|grand(?:mother|father|parents?)|sisters?|brothers?|daughters?|sons?|wife|husband|"
    r"students?|teachers?|doctors?|nurses?|farmers?|workers?|villagers?|monks?|soldiers?|warriors?|swordsm[ae]n|"
    r"king|queen|princess|prince|lady|gentleman|character|customers?|vendors?|chefs?|drivers?)\b",
    re.I,
)
NATIONALITY_RE = re.compile(r"\b(Vietnamese|Japanese|Korean|Chinese|Thai|Asian|Indian|African|European|American)\b", re.I)


FACE_MODEL = Path(os.getenv("FACE_MODEL", str(Path.home() / "Developer/local-ai/models/face/face_detection_yunet_2023mar.onnx")))
# Counted so /health (and the website's Settings) shows the pass is really running: a step that fails quietly is how
# the hand-drawn videos stayed broken without anyone noticing.
FACE_STATS = {"images": 0, "faces": 0, "skipped": 0, "lastError": None}


def face_detail_state():
    """(ready, detail) for /health."""
    if not FACE_DETAIL:
        return False, "Đã tắt bằng FACE_DETAIL=false"
    missing = [name for name, path in (("Python có OpenCV", Path(FACE_PYTHON)), ("mô hình dò mặt", FACE_MODEL),
                                       ("face_detail.py", FACE_SCRIPT)) if not path.exists()]
    if missing:
        return False, "Thiếu " + ", ".join(missing)
    stats = f"đã sửa {FACE_STATS['faces']} khuôn mặt trong {FACE_STATS['images']} ảnh từ lúc khởi động"
    if FACE_STATS["lastError"]:
        return True, f"Sẵn sàng; {stats}; lỗi gần nhất: {FACE_STATS['lastError']}"
    return True, f"Sẵn sàng; {stats}"


def detail_faces(image, style_words, prompt, seed):
    if not face_detail_state()[0]:
        FACE_STATS["skipped"] += 1
        return image
    nationality = NATIONALITY_RE.search(prompt)
    # Naming who it is keeps Asian faces Asian; without it the redraw drifted to Western features.
    who = f"a {nationality.group(1).capitalize()} person" if nationality else "a person"
    try:
        with tempfile.TemporaryDirectory(prefix="studio-face-") as workdir:
            source, target = Path(workdir) / "in.png", Path(workdir) / "out.png"
            source.write_bytes(image)
            done = subprocess.run([FACE_PYTHON, "-I", str(FACE_SCRIPT), str(source), str(target), "--style", style_words,
                                   "--who", who, "--seed", str(seed if seed is not None else 7)],
                                  capture_output=True, text=True, timeout=240,
                                  env={**os.environ, "IMAGE_SERVER_URL": IMAGE_SERVER_URL})
            if done.returncode != 0:
                raise RuntimeError(done.stderr.strip().splitlines()[-1] if done.stderr.strip() else f"exit {done.returncode}")
            faces = json.loads(done.stdout.strip().splitlines()[-1]).get("faces", 0)
            FACE_STATS["images"] += 1
            FACE_STATS["faces"] += faces
            print(f"[face] redrew {faces} face(s) as {who}", flush=True)
            if faces and target.exists():
                return target.read_bytes()
    except Exception as error:  # noqa: BLE001 - the picture without the redraw is still usable
        FACE_STATS["skipped"] += 1
        FACE_STATS["lastError"] = str(error)[:200]
        print(f"[face] skipped: {error}", flush=True)
    return image


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
    is_flat = style == "flat"
    stylized = style in STYLIZED_IMAGE_STYLES
    is_human = bool(HUMAN_PROMPT_RE.search(clean))
    anatomy = (
        "one person only, one face, two aligned eyes, symmetrical natural facial features, natural skin texture, "
        "anatomically correct hands, natural body proportions, complete limbs"
        if IMAGE_ANATOMY_GUARD and is_human and not stylized
        else ""
    )
    anatomy_prefix = f", {anatomy}" if anatomy else ""
    human_detail = ", natural skin, detailed face" if is_human and not stylized else ""
    nonhuman_focus = "" if (is_human or stylized) else ", the described object or environment is the main subject, no people, no human figures, no face"
    flat_guard = ", only the described characters, no crowd" if is_flat and is_human else ""
    styled = f"{IMAGE_STYLES[style]}{flat_guard}{human_detail}{anatomy_prefix}{nonhuman_focus}, {clean}, no text, no logo, no watermark"
    if model == COMFYUI_IMAGE_MODEL:
        if reference_image_base64:
            raise ValueError("SDXL Base qua ComfyUI hiện hỗ trợ text-to-image; hãy bỏ ảnh tham chiếu hoặc chọn SDXL-Turbo")
        negative = IMAGE_NEGATIVE_PROMPT if IMAGE_ANATOMY_GUARD else "text, logo, watermark"
        if is_human:  # SDXL Base honours a negative prompt (real CFG), unlike Turbo: keep scenes to their cast
            negative += ", crowd, group of people, extra people, duplicate person, clones"
        with COMFYUI_LOCK:
            release_turbo_model()
            IMAGE_ENGINE["comfy_used"] = True
            return comfyui_image(styled, negative, width, height, seed, preset)
    release_comfy_model()
    # SDXL-Turbo is distilled to work without guidance. A negative prompt only takes effect with CFG > 1, which runs
    # the UNet twice per step: 8 steps + negative took 20.9 s per image against 6.9 s for 4 plain steps, with no
    # visible gain in faces or hands (side-by-side check, photo and flat). Drawn looks get the 4 steps they are made
    # for, a realistic person 6; only the explicit "quality" preset keeps 8 steps with the anatomy negative.
    steps = preset_options["steps"]
    turbo_negative = ""
    if selected_preset == "quality":
        turbo_negative = IMAGE_NEGATIVE_PROMPT if IMAGE_ANATOMY_GUARD else ""
    elif is_human and not stylized and selected_preset == "balanced":
        steps = IMAGE_PERSON_STEPS
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
        recycle_if_bloated("image", IMAGE_SERVER_URL)  # a restart reloads the model (~1 min) but frees GBs of cache
        payload = {"prompt": styled, "model": model, "seed": seed, "steps": int(IMAGE_STEPS_OVERRIDE or steps), "preset": selected_preset,
                   "width": width, "height": height, "negativePrompt": turbo_negative}
        if reference_image_base64 and is_human:
            payload["referenceImage"] = reference_image_base64
        request = urllib.request.Request(f"{IMAGE_SERVER_URL}/generate", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=IMAGE_TIMEOUT_S) as response:
            image = response.read()
        return detail_faces(image, IMAGE_STYLES[style], clean, seed) if FACE_SUBJECT_RE.search(clean) else image
    with IMAGE_LOCK, tempfile.TemporaryDirectory(prefix="studio-image-") as workdir:
        target = Path(workdir) / "image.png"
        subprocess.run(["/bin/zsh", str(IMAGE_SCRIPT), styled, str(target)],
                       check=True, timeout=IMAGE_TIMEOUT_S, capture_output=True)
        return target.read_bytes()


SENTENCE_END = re.compile(r"[.!?…。！？][\"'”’)]?\s*$")
CLAUSE_END = re.compile(r"[,;:—–][\"'”’)]?\s*$")


def _words(tokens):
    return sum(bool(token.strip()) for token in tokens)


def _split_long(tokens):
    """One sentence that is too long for one request: cut at the comma nearest its middle, else in the middle.
    A cut that leaves under four words on either side is never made ("…một ly cà | phê." made VieNeu say "Fê")."""
    if _words(tokens) <= TTS_BREAK_WORDS and len("".join(tokens)) <= 240:
        return ["".join(tokens)]
    word_ends = [i for i, token in enumerate(tokens) if token.strip()]
    total = len(word_ends)
    middle = total / 2
    allowed = [k for k in range(4, total - 3)]  # k words go left
    clause = [k for k in allowed if CLAUSE_END.search(tokens[word_ends[k - 1]])]
    if clause:
        k = min(clause, key=lambda candidate: abs(candidate - middle))
    elif allowed:
        k = min(allowed, key=lambda candidate: abs(candidate - middle))
    else:
        return ["".join(tokens)]
    cut = word_ends[k - 1] + 1
    return _split_long(tokens[:cut]) + _split_long(tokens[cut:])


def split_speech_phrases(text):
    """Original contiguous sentences/clauses; timing is measured after synthesis.

    One sentence per synthesis request lets VieNeu give each sentence its own prosody; a sentence longer than
    TTS_BREAK_WORDS is divided at a clause boundary into balanced parts, never into a tail of one or two words."""
    if not text.strip() or len(text) > 5000:
        raise ValueError("Lời đọc trống hoặc quá dài cho một cảnh")
    tokens = re.findall(r"\S+\s*|\s+", text)
    if any(len(token) > 240 for token in tokens):
        raise ValueError("Lời đọc có một từ quá dài cho phụ đề")
    sentences, current = [], []
    for token in tokens:
        current.append(token)
        if _words(current) >= 2 and SENTENCE_END.search(token):
            sentences.append(current)
            current = []
    if current:
        if not "".join(current).strip() and sentences:
            sentences[-1] += current
        else:
            sentences.append(current)
    return [phrase for sentence in sentences for phrase in _split_long(sentence)]


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


# Long-running model servers grow (VieNeu reached 7.9 GB, the MLX image server 11 GB) until a 16 GB Mac swaps and
# every image takes minutes. Recycle them through launchd (KeepAlive restarts them clean) when they get bloated.
SUPERVISED = {  # name -> (launchd label, port, health URL, limit in MB)
    "vieneu": ("com.ai-short-video.vieneu", 5001, None, int(os.getenv("VIENEU_MAX_MB", "3000"))),
    "image": ("com.ai-short-video.image", 5002, None, int(os.getenv("IMAGE_MAX_MB", "9000"))),
}
RECYCLE_LOCK = threading.Lock()


def process_footprint_mb(pid):
    """Memory footprint including compressed pages (what really pressures the Mac); None if unknown."""
    try:
        out = subprocess.run(["top", "-l", "1", "-pid", str(pid), "-stats", "mem"],
                             capture_output=True, text=True, timeout=20).stdout.strip().splitlines()
        match = re.fullmatch(r"([\d.]+)([KMG])[+-]?", out[-1].strip())
        if not match:
            return None
        return float(match.group(1)) * {"K": 1 / 1024, "M": 1, "G": 1024}[match.group(2)]
    except Exception:
        return None


def listener_pid(port):
    try:
        out = subprocess.run(["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"], capture_output=True, text=True, timeout=10).stdout
        return int(out.split()[0]) if out.split() else None
    except Exception:
        return None


def recycle_if_bloated(name, base_url, wait_s=240):
    """Restart a launchd-supervised model server whose footprint passed its limit. True if it was restarted."""
    label, port, _, limit_mb = SUPERVISED[name]
    with RECYCLE_LOCK:
        pid = listener_pid(port)
        footprint = process_footprint_mb(pid) if pid else None
        if footprint is None or footprint < limit_mb:
            return False
        kicked = subprocess.run(["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{label}"],
                                capture_output=True, timeout=30)
        if kicked.returncode != 0:  # not supervised: restarting would leave it dead
            return False
        print(f"[local-media] recycled {name}: {footprint:.0f} MB > {limit_mb} MB", flush=True)
        deadline = time.time() + wait_s
        while time.time() < deadline:
            time.sleep(3)
            new_pid = listener_pid(port)
            if new_pid and new_pid != pid and (name == "image" and image_server_state() == "ready" or
                                                name != "image" and service_up(base_url)):
                return True
        raise RuntimeError(f"Dịch vụ {name} khởi động lại quá lâu; kiểm tra máy và thử lại")


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


def pace_tempo(voice, engine, speed=1.0, emotion=1.0):
    """Time-stretch factor that brings this voice to the target pace (see VOICE_PRESETS)."""
    requested_speed = max(0.75, min(float(speed), 1.3))
    _name, mood, native = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0, None))
    if engine != "vieneu":
        mood, native = 1.0, PIPER_NATIVE_WPS
    if native is None:  # a voice that was never measured keeps its own pace
        return mood * requested_speed * emotion
    target = PACE_TARGET_WPS * mood * requested_speed * emotion / PACE_VIDEO_FACTOR
    return target / native


def synth_phrase(phrase, workdir, index, voice, engine, speed=1.0):
    vieneu_voice = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0, None))[0]
    profile = emotion_profile(phrase, voice) if engine == "vieneu" else None
    vieneu_speed = pace_tempo(voice, engine, speed, profile["speed"] if profile else 1.0)
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
    # VieNeu v3 Turbo (and Piper) ignore the `speed` field, so pace — the voice preset, the emotion profile and the
    # video's voiceSpeed — is applied here as a pitch-preserving time stretch. Cue timing is still read from the audio.
    return _time_stretch(_to_pcm22050(source), vieneu_speed)


def _time_stretch(source, tempo):
    tempo = max(0.7, min(float(tempo), 1.45))
    if abs(tempo - 1.0) < 0.03:
        return source
    target = source.with_name(f"{source.stem}-tempo.wav")
    subprocess.run([require_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
                    "-filter:a", f"atempo={tempo:.3f}", "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", str(target)],
                   check=True, timeout=120, capture_output=True)
    return target


def tts_aligned(text, voice, engine=None, speed=1.0):
    phrases = split_speech_phrases(text)
    selected_engine = select_tts_engine(voice, engine)
    if selected_engine == "vieneu":
        with VIENEU_LOCK:
            recycle_if_bloated("vieneu", VIENEU_URL)
    chunks, cues, frames_total = [], [], 0
    sample_rate = SAMPLE_RATE
    with tempfile.TemporaryDirectory(prefix="studio-aligned-") as workdir:
        # Phrase synthesis is independent. Keep output order deterministic while
        # overlapping a small, bounded number of local requests.
        with ThreadPoolExecutor(max_workers=min(TTS_CONCURRENCY, len(phrases))) as pool:
            futures = [
                pool.submit(synth_phrase, phrase, workdir, index, voice, selected_engine, speed)
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
    if selected_engine == "vieneu":
        with VIENEU_LOCK:
            recycle_if_bloated("vieneu", VIENEU_URL)
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
            face_ready, face_detail = face_detail_state()
            json_response(self, 200, {"ok": image_ready and tts_ready, "image": image_ready,
                                    "faceDetail": face_ready, "faceDetailDetail": face_detail,
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
                json_response(self, 200, tts_aligned(str(payload.get("text", "")), str(payload.get("voice", "doc-truyen")), payload.get("engine"), payload.get("speed", 1.0)))
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


SERVICE_LOG_DIR = Path(__file__).resolve().parents[1] / "tmp" / "local-services"


def trim_service_logs(directory=SERVICE_LOG_DIR, max_bytes=5 * 1024 * 1024, keep_bytes=1024 * 1024):
    """launchd appends service logs forever (one crash loop wrote 14 MB); keep only the recent tail of big ones."""
    trimmed = []
    for path in sorted(Path(directory).glob("*.log")) + sorted(Path(directory).glob("*.err")):
        try:
            if path.stat().st_size <= max_bytes:
                continue
            with path.open("rb") as handle:
                handle.seek(-keep_bytes, os.SEEK_END)
                tail = handle.read()
            tail = tail[tail.find(b"\n") + 1:]  # start on a whole line
            path.write_bytes(b"[log trimmed]\n" + tail)
            trimmed.append(path.name)
        except OSError:
            continue
    return trimmed


if __name__ == "__main__":
    for name in trim_service_logs():
        print(f"[local-media] trimmed log {name}", flush=True)
    print(f"Local media server listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
