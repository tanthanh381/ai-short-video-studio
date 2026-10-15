"""Local-only media bridge for the self-hosted worker.

It deliberately binds to the local machine and exposes no cloud credentials. The
Docker worker calls this bridge through host.docker.internal.
"""

import json
import array
import base64
import io
import math
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import idle_sleep  # noqa: E402
import node_status  # noqa: E402  (sibling module; also imported when this file is loaded by path in tests)
import sync_manifest  # noqa: E402

HOST = os.getenv("LOCAL_MEDIA_HOST", "127.0.0.1")
# Set when this bridge is reachable from other machines (a second Mac that takes part of the work): every request except
# /health must then carry `Authorization: Bearer <NODE_TOKEN>`. The main machine sends it as AI_NODES_TOKEN.
NODE_TOKEN = os.getenv("NODE_TOKEN", "")
NODE_NAME = os.getenv("NODE_NAME", socket.gethostname().split(".")[0])
METRICS = node_status.Metrics()
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
NODE_START_SCRIPT = os.getenv("NODE_START_SCRIPT", "")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
COMFYUI_CHECKPOINT = os.getenv("COMFYUI_CHECKPOINT", "sd_xl_base_1.0_0.9vae.safetensors")
COMFYUI_MODEL_DIR = Path(os.getenv(
    "COMFYUI_MODEL_DIR",
    str(LOCAL_AI_ROOT / "ComfyUI" / "models" / "checkpoints"),
))
COMFYUI_TIMEOUT_S = int(os.getenv("COMFYUI_TIMEOUT_S", "900"))
# Voice presets selectable on the website. Keep ids in sync with packages/shared/src/voices.ts and duration.ts.
# (VieNeu preset voice, mood, native words/second at speed 1.0).
#
# Pace. Every voice is brought to PACE_TARGET_WPS × mood words per second of finished video, but only within
# PACE_TEMPO_RANGE: a time stretch beyond about +-18% is audible (phasey, hurried or drawn-out speech), and the emotional
# presets used to be stretched by +30% (Đức Trí) or slowed by 20% (Trúc Ly, Minh Triết, Hải Đăng). Their voices are now
# storytelling voices (the model's own "doc_truyen" style, more pitch movement and pauses) whose native pace is close to the
# pace wanted, and where a voice is naturally slow (Đức Trí, Thiền Tâm Đức, Kim Thanh: 2.8-2.9 w/s) the preset reads at
# about 3 w/s rather than being forced to 3.7. Native pace = the voice's words per second, sentence by sentence, without
# pauses, measured on 298 words of real script.
VOICE_PRESETS = {
    "doc-truyen": ("Đức Trí", 0.80, 2.87),
    "co-trang": ("Thiền Tâm Đức", 0.80, 2.89),
    "co-trang-nu": ("Quỳnh Anh", 0.86, 3.58),
    "triet-ly": ("Thái Sơn", 0.84, 3.69),
    "tam-su": ("Kim Thanh", 0.78, 2.78),
    "tin-tuc": ("Quang Sơn", 1.05, 3.34),
    "tin-tuc-nu": ("Ngọc Huyền", 1.05, 4.16),
    "thuyet-minh": ("Phạm Tuyên", 1.02, 4.10),
    "nang-dong": ("Xuân Vĩnh", 1.05, 4.30),
}
# Short-form narration lands at 3.3-4.2 words/s; 3.7 is the middle (before a voice's mood).
PACE_TARGET_WPS = float(os.getenv("PACE_TARGET_WPS", "3.7"))
# Share of a finished narration that is speech: the rest is the pauses between phrases (PAUSE_S below). Measured on 298 words of
# real script read by all nine presets: 0.78-0.87, 0.835 on average (shorter sentences, more pauses).
PACE_VIDEO_FACTOR = 0.84
PACE_TEMPO_RANGE = (0.85, 1.18)
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


# Pictures are drawn at the size the model was trained for and scaled to the video afterwards (multiples of 64, aspect within 3.6%).
# SDXL-Turbo is distilled at 512x512 (262k px). Above that it draws people twice: stacked in a tall frame, side by side in a wide one,
# with stretched bodies and extra arms and legs. Measured on 8 prompts x 4 seeds of people facing the camera, pictures with MORE
# faces than people asked for: 9:16 at 576x1024 9 of 32, at 512x896 4 of 32; 16:9 at 1024x576 25 of 32, at 896x512 15, at 768x448 9;
# square at 704x704 8 of 32, at 576x576 5. For one bench scene, 576x1024 drew a second man above the first in 5 of 8 seeds, 512x896 in 0 of 8.
TURBO_IMAGE_SIZES = {"9:16": (512, 896), "1:1": (576, 576), "16:9": (768, 448), "16:10": (704, 448)}
# SDXL Base is trained at about a million pixels, and 576x1024 (590k) is below that: two of four bench pictures came out as two
# scenes stacked in one. 704x1216 (856k) gave four clean pictures in 145 s each (768x1344: also clean, 199 s; 576x1024: 116 s).
BASE_IMAGE_SIZES = {"9:16": (704, 1216), "1:1": (896, 896), "16:9": (1216, 704), "16:10": (1088, 704)}
IMAGE_SIZES = TURBO_IMAGE_SIZES  # the aspect ratios both tables answer to


def image_size(aspect_ratio, model=None):
    """Width and height to draw a picture of this aspect ratio with this model."""
    return (BASE_IMAGE_SIZES if model == COMFYUI_IMAGE_MODEL else TURBO_IMAGE_SIZES)[aspect_ratio]


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
        "sợ hãi", "chia tay", "mất mát", "nhớ thương", "buông bỏ", "hãy cho phép mình nghỉ", "nếu hôm nay",
    ),
    "chuckle": (
        "vui", "hạnh phúc", "tuyệt vời", "chúc mừng", "tự hào", "may mắn", "phấn khởi", "rộn ràng",
        "ưu đãi", "quà tặng", "bất ngờ thú vị",
    ),
    "clear_throat": (
        "quan trọng", "chú ý", "cảnh báo", "lưu ý", "bắt buộc", "điều cần biết", "sự thật là", "ngay bây giờ",
    ),
}
EMOTION_PROFILE = {
    "sigh": {"tag": "[thở dài]", "speed": 0.94},
    "chuckle": {"tag": "[cười]", "speed": 1.04},
    "clear_throat": {"tag": "[hắng giọng]", "speed": 0.98},
}
# A non-verbal cue (a sigh, a chuckle, a throat-clear) is a sound in the recording: used often it is a tic. It needs this many
# different markers in the same sentence, and a narration (one scene) gets at most one.
EMOTION_MIN_MARKERS = 2


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
    # "Quy tắc cổ nhân" shorts: soft sepia ink-and-watercolor storybook pictures (not the black pen drawing of "ink").
    "ink-wash": "soft sepia ink and watercolor storybook illustration, ancient China, muted grey-brown palette, gentle misty wash, thin brush outlines, detailed faces",
    "watercolor": "delicate watercolor painting, soft bleeding washes, visible paper grain, pastel palette",
    "paper-cut": "layered paper-cut art, colored paper shapes, clean silhouettes, soft cast shadows",
    # Drawn by the hand renderer: it inks the dark outlines first, then washes in the flat colours. Photos have no
    # outlines to follow (sparse specks, then white holes where the background matched the paper), so this look only.
    "whiteboard": "whiteboard doodle illustration, bold black marker outlines, flat pastel colors, plain white background",
    # "Đạo lý cổ phong": one small character on plain kraft paper; the website places the square picture on paper.
    "chibi": "cute chibi illustration, plain beige kraft paper background, olive green ancient robe, clean ink outlines, full body, empty background",
}
# Drawn looks: photo skin/anatomy wording would pull them back towards photographs.
STYLIZED_IMAGE_STYLES = {"flat", "ink", "ink-wash", "watercolor", "paper-cut", "whiteboard", "chibi"}
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
    width, height = image_size(aspect_ratio, model)
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
        # Chibi faces are big, simple shapes by design; a "detailed face" redraw would turn them half-realistic.
        return detail_faces(image, IMAGE_STYLES[style], clean, seed) if style != "chibi" and FACE_SUBJECT_RE.search(clean) else image
    with IMAGE_LOCK, tempfile.TemporaryDirectory(prefix="studio-image-") as workdir:
        target = Path(workdir) / "image.png"
        subprocess.run(["/bin/zsh", str(IMAGE_SCRIPT), styled, str(target)],
                       check=True, timeout=IMAGE_TIMEOUT_S, capture_output=True)
        return target.read_bytes()


SENTENCE_END = re.compile(r"[.!?…。！？][\"'”’)]?\s*$")
CLAUSE_END = re.compile(r"[,;:—–][\"'”’)]?\s*$")
CLAUSE_OR_ELLIPSIS_END = re.compile(r"(?:[,;:—–]|…|\.\.\.)[\"'”’)]?\s*$")


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
    # "Cuối cùng…", "Nên nhớ:", "Thế nhưng," lead into the next sentence: said alone they get a falling, finished intonation.
    merged = []
    for sentence in sentences:
        if merged and _words(merged[-1]) <= 3 and CLAUSE_OR_ELLIPSIS_END.search(merged[-1][-1]):
            merged[-1] = merged[-1] + sentence
        else:
            merged.append(sentence)
    return [phrase for sentence in merged for phrase in _split_long(sentence)]


def emotion_profile(text, voice=""):
    """A speaking cue for a sentence that is clearly about one feeling, else None.

    Deterministic and conservative: it needs EMOTION_MIN_MARKERS different marker phrases in the one sentence, so a theme word that
    comes back in every line ("im lặng", "người") never turns every line into a sigh. The voice plays no part; an explicit
    [thở dài] / [cười] / [hắng giọng] typed in the script is left alone. VieNeu maps the three cues to its trained emotion tokens.
    """
    if EMOTION_TAG_RE.search(text):
        return None
    normalized = normalize_vi_text(text)
    scores = {
        name: sum(1 for marker in markers if re.search(rf"(?<!\w){re.escape(marker)}(?!\w)", normalized))
        for name, markers in NORMALIZED_EMOTION_MARKERS.items()
    }
    best, score = max(scores.items(), key=lambda item: item[1])
    return EMOTION_PROFILE[best] if score >= EMOTION_MIN_MARKERS else None


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


POWER_PORTS = (11434, 8080, 5000, 5001, 5002, 8766, 8770, 8188)


def stop_local_ai_services():
    """Stop model servers and their Python runtimes, but keep this bridge alive for a later resume.

    The bridge is deliberately not killed: the website needs a small control endpoint to turn the node on again.
    Docker/Colima is also left alone because on the primary Mac it hosts the API and worker themselves.
    """
    stopped = []
    for port in POWER_PORTS:
        pid = listener_pid(port)
        if not pid or pid == os.getpid():
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            stopped.append({"port": port, "pid": pid})
        except ProcessLookupError:
            pass
        except PermissionError:
            raise RuntimeError(f"Không có quyền dừng dịch vụ ở cổng {port}")
    deadline = time.time() + 8
    while time.time() < deadline and any(listener_pid(item["port"]) for item in stopped):
        time.sleep(0.25)
    for item in stopped:
        pid = listener_pid(item["port"])
        if pid and pid != os.getpid():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return stopped


def start_local_ai_services():
    """Ask the same launcher used at boot to restore the model servers."""
    if not NODE_START_SCRIPT:
        raise RuntimeError("Thiếu NODE_START_SCRIPT để bật lại các dịch vụ AI local")
    script = Path(NODE_START_SCRIPT)
    if not script.is_file():
        raise RuntimeError(f"Không tìm thấy script bật máy: {script}")
    repo = script.parent.parent
    log_path = SERVICE_LOG_DIR / "node-control.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("ab")
    try:
        subprocess.Popen(["/bin/zsh", str(script)], cwd=str(repo), stdin=subprocess.DEVNULL,
                         stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    finally:
        handle.close()


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
    """Time-stretch factor that brings this voice to the target pace (see VOICE_PRESETS), never beyond PACE_TEMPO_RANGE by itself;
    the video's own reading speed (and an emotion cue) multiply on top of that."""
    requested_speed = max(0.75, min(float(speed), 1.3))
    _name, mood, native = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0, None))
    if engine != "vieneu":
        mood, native = 1.0, PIPER_NATIVE_WPS
    if native is None:  # a voice that was never measured keeps its own pace
        return mood * requested_speed * emotion
    wanted = PACE_TARGET_WPS * mood / PACE_VIDEO_FACTOR
    automatic = max(PACE_TEMPO_RANGE[0], min(wanted / native, PACE_TEMPO_RANGE[1]))
    return automatic * requested_speed * emotion


def synth_phrase(phrase, workdir, index, voice, engine, speed=1.0, emotion_ok=True):
    vieneu_voice = VOICE_PRESETS.get(voice, (VIENEU_VOICE, 1.0, None))[0]
    profile = emotion_profile(phrase, voice) if engine == "vieneu" and emotion_ok else None
    vieneu_speed = pace_tempo(voice, engine, speed, profile["speed"] if profile else 1.0)
    input_text = f"{profile['tag']} {phrase.lstrip()}" if profile else phrase
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


# Pauses between spoken phrases, in seconds. These are the minimum silences VieNeu's own join puts between the chunks of one
# request (its authors measured them on 23 voices: comma 0.30-0.45, end of sentence 0.50-0.65, paragraph 0.70). The bridge
# synthesises one sentence per request, so it has to put them in itself: it used to join sentences with whatever silence each
# file happened to carry, 0-270 ms, and sentences ran into each other (and scenes into each other, every scene being a call).
PAUSE_S = {"para": 0.70, "sentence": 0.50, "ellipsis": 0.60, "minor": 0.30, "split": 0.20}
# Reflective voices hold a pause a little longer, an ad a little shorter.
PAUSE_MOOD = {"doc-truyen": 1.15, "co-trang": 1.25, "co-trang-nu": 1.2, "triet-ly": 1.25, "tam-su": 1.25, "nang-dong": 0.8}
PAUSE_MAX_S = 1.0
# A scene ends where the writer's thought ends, so the silence after its last phrase is a little shorter than between sentences.
SCENE_END_PAUSE = 0.85
EDGE_THRESH_DB = -45.0  # what counts as silence at the edge of a recording (VieNeu uses the same)
LEVEL_RANGE_DB = 2.5  # a phrase louder or quieter than the narration's typical level is brought back to within this


def pause_kind(phrase):
    """What kind of boundary follows this phrase: para, sentence, ellipsis, minor (comma, colon, dash) or split (cut mid-clause)."""
    body = phrase.rstrip()
    if phrase[len(body):].count("\n") >= 2:
        return "para"
    core = body.rstrip("\"'”’)»]")
    if core.endswith("…") or core.endswith("..."):
        return "ellipsis"
    if re.search(r"[.!?。！？]$", core):
        return "sentence"
    if re.search(r"[,;:—–，；]$", core):
        return "minor"
    return "split"


def pause_seconds(phrase, voice):
    """The silence wanted after a phrase: by kind, longer after a line the author ended on purpose, scaled by the voice's mood."""
    kind = pause_kind(phrase)
    seconds = PAUSE_S[kind]
    if kind in ("sentence", "ellipsis") and phrase[len(phrase.rstrip()):].count("\n") == 1:
        seconds += 0.10
    return min(PAUSE_MAX_S, seconds * PAUSE_MOOD.get(voice, 1.0))


def _samples(pcm):
    values = array.array("h")
    values.frombytes(pcm)
    if sys.byteorder == "big":
        values.byteswap()
    return values


def _pcm(values):
    if sys.byteorder == "big":
        values = array.array("h", values)
        values.byteswap()
    return values.tobytes()


def _window_levels(values, window):
    """Mean absolute level of each window (the last one may be shorter, and counts)."""
    return [sum(map(abs, chunk)) / len(chunk) for chunk in (values[i:i + window] for i in range(0, len(values), window))]


def edge_silence_frames(pcm, rate=SAMPLE_RATE):
    """(silent frames at the start, silent frames at the end) of mono 16-bit PCM."""
    values = _samples(pcm)
    window = max(1, int(0.01 * rate))
    levels = _window_levels(values, window)
    loud = [i for i, level in enumerate(levels) if level > 32768 * 10 ** (EDGE_THRESH_DB / 20)]
    if not loud:
        return len(values), 0
    return loud[0] * window, len(values) - min(len(values), (loud[-1] + 1) * window)


def speech_level_db(pcm, rate=SAMPLE_RATE):
    """Average level of the louder half of the windows (the speech, not the silences), in dB below full scale; None for a silent clip."""
    levels = sorted(_window_levels(_samples(pcm), max(1, int(0.01 * rate))))
    loud = levels[len(levels) // 2:]
    mean = sum(loud) / len(loud) if loud else 0
    return 20 * math.log10(mean / 32768) if mean > 0 else None


def apply_gain_db(pcm, gain_db):
    """The clip louder or quieter by gain_db, without ever clipping."""
    if abs(gain_db) < 0.7:
        return pcm
    values = _samples(pcm)
    factor = 10 ** (gain_db / 20)
    peak = max((abs(v) for v in values), default=1) or 1
    factor = min(factor, 32000 / peak)
    return _pcm(array.array("h", (int(v * factor) for v in values)))


def level_phrases(pcms, rate=SAMPLE_RATE):
    """Brings a phrase that is much louder or quieter than the rest (the cue sounds, an odd take) back to within LEVEL_RANGE_DB."""
    levels = [speech_level_db(pcm, rate) for pcm in pcms]
    known = sorted(level for level in levels if level is not None)
    if len(known) < 3:
        return pcms
    median = known[len(known) // 2]
    return [pcm if level is None else apply_gain_db(pcm, max(-LEVEL_RANGE_DB, min(LEVEL_RANGE_DB, median - level)) if abs(median - level) > LEVEL_RANGE_DB else 0.0)
            for pcm, level in zip(pcms, levels)]


def with_pause(pcm, wanted_s, next_lead_frames=0, rate=SAMPLE_RATE):
    """The phrase followed by enough silence that, together with the silence it already ends with and the one the next phrase
    starts with, the gap is at least wanted_s. A phrase that already has the pause is left as it is."""
    _lead, tail = edge_silence_frames(pcm, rate)
    missing = int(wanted_s * rate) - tail - next_lead_frames
    if missing <= 0:
        return pcm
    if tail < int(0.01 * rate):  # it stops abruptly: a short fade so the silence does not click
        values = _samples(pcm)
        fade = min(len(values), int(0.006 * rate))
        for i in range(fade):
            values[len(values) - fade + i] = int(values[len(values) - fade + i] * (1 - (i + 1) / fade))
        pcm = _pcm(values)
    return pcm + b"\x00\x00" * missing


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
        # A non-verbal cue (sigh, chuckle) is a sound in the recording: at most one in a narration, on the first sentence that earns it.
        cue_index = next((index for index, phrase in enumerate(phrases) if selected_engine == "vieneu" and emotion_profile(phrase, voice)), None)
        with ThreadPoolExecutor(max_workers=min(TTS_CONCURRENCY, len(phrases))) as pool:
            futures = [
                pool.submit(synth_phrase, phrase, workdir, index, voice, selected_engine, speed, index == cue_index)
                for index, phrase in enumerate(phrases)
            ]
            sources = [future.result() for future in futures]
        pcms = []
        for source in sources:
            with wave.open(str(source), "rb") as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (sample_rate, 1, 2):
                    raise RuntimeError("Giọng đọc local trả định dạng audio không hợp lệ")
                frames = audio.getnframes()
                pcm = audio.readframes(frames)
                if frames <= 0 or len(pcm) != frames * 2:
                    raise RuntimeError("Giọng đọc không tạo được âm thanh")
            pcms.append(pcm)
        pcms = level_phrases(pcms, sample_rate)
        for index, (phrase, pcm) in enumerate(zip(phrases, pcms)):
            last = index == len(phrases) - 1
            wanted = pause_seconds(phrase, voice) * (SCENE_END_PAUSE if last else 1.0)
            pcm = with_pause(pcm, wanted, 0 if last else edge_silence_frames(pcms[index + 1], sample_rate)[0], sample_rate)
            frames = len(pcm) // 2
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


def _comfy_up():
    return comfyui_state()[0] == "ready"


def _ltx_up():
    return ltx_state()[0] == "ready"


# The big model servers sleep (their launchd job is unloaded) when nothing used them for STUDIO_IDLE_SLEEP_MIN minutes (default 5,
# 0 = never) and wake on the next request that needs them. The weights of an idle SDXL server alone are 5 GB of a 16 GB Mac.
_REPO_ROOT = Path(__file__).resolve().parents[1]
_LOGS = _REPO_ROOT / "tmp" / "local-services"


def _by_script(name, port, *argv):
    """For a Mac that starts the server from scripts/Mo-May-Phu.command (the Air) instead of from a launchd job."""
    return idle_sleep.ProcessControl(name, port, argv, _LOGS / "asleep.json", cwd=str(_REPO_ROOT), log_path=_LOGS / f"{name}.log")


SLEEPER = idle_sleep.Sleeper([
    idle_sleep.Service("image", "com.ai-short-video.image", lambda: image_server_state() == "ready", wake_timeout_s=420,
                       process=_by_script("image", 5002, LOCAL_AI_ROOT / "venv/bin/python", _REPO_ROOT / "local-tools/image_server.py")),
    idle_sleep.Service("vieneu", "com.ai-short-video.vieneu", lambda: service_up(VIENEU_URL), wake_timeout_s=300,
                       process=_by_script("vieneu", 5001, "/bin/zsh", LOCAL_AI_ROOT / "bin/start-vieneu.sh")),
    idle_sleep.Service("whisper", "com.ai-short-video.whisper", lambda: service_up(WHISPER_URL, "/"), wake_timeout_s=180,
                       process=_by_script("whisper", 8080, "/bin/zsh", LOCAL_AI_ROOT / "bin/start-whisper.sh")),
    idle_sleep.Service("comfyui", "com.ai-short-video.comfyui", _comfy_up, wake_timeout_s=300, idle_cap_s=180),
    idle_sleep.Service("ltx", "com.ai-short-video-studio.ltx", _ltx_up, wake_timeout_s=300, idle_cap_s=180),
], idle_sleep.configured_idle_seconds())


def services_for(path, body):
    """The sleeping-capable services a request needs (the ComfyUI one only when the picture asks for that model)."""
    route = path.split("?")[0]
    if route == "/image":
        try:
            model = json.loads(body).get("model")
        except (ValueError, AttributeError):
            model = None
        return ["image", "comfyui"] if model == COMFYUI_IMAGE_MODEL else ["image"]
    if route in ("/tts", "/tts-aligned"):
        return ["vieneu"]
    if route == "/transcribe":
        return ["whisper"]
    if route == "/video":
        return ["ltx"]
    return []


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


def image_server_info():
    """(state, config) of the MLX image server; the config (steps, cfg weight, preset) comes from its /health body."""
    try:
        with urllib.request.urlopen(f"{IMAGE_SERVER_URL}/health", timeout=3) as response:
            return "ready", json.load(response).get("config") or {}
    except urllib.error.HTTPError as error:
        try:
            return "loading", json.loads(error.read().decode()).get("config") or {}
        except Exception:
            return "loading", {}
    except Exception:
        return "down", {}


def remembered_image_config(config):
    """The image server's settings are part of this Mac's fingerprint. While it sleeps they cannot be read, so the last ones seen
    (kept in a file, to survive a bridge restart) stand in; otherwise a sleeping Mac would look different from the main one."""
    cache = SERVICE_LOG_DIR / "image-config.json"
    if config:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            if not cache.exists() or json.loads(cache.read_text()) != config:
                cache.write_text(json.dumps(config))
        except (OSError, ValueError):
            pass
        return config
    try:
        return json.loads(cache.read_text())
    except (OSError, ValueError):
        return {}


def tts_engines_up():
    return [e for e in TTS_ENGINES if service_up({"vieneu": VIENEU_URL, "piper": PIPER_URL}.get(e, ""), "/health") or SLEEPER.asleep(e)]


# Everything whose change would make this Mac's pictures or voices come out differently. Two Macs with different files here must not
# share a video, so a change in any of them (not only in the two servers) separates the fingerprints.
NODE_STATUS_SOURCES = [
    Path(__file__).resolve(), Path(__file__).with_name("image_server.py"), Path(__file__).with_name("face_detail.py"),
    LOCAL_AI_ROOT / "vieneu_api.py", LOCAL_AI_ROOT / "vieneu_tts.py", LOCAL_AI_ROOT / "tts_api.py",
]
_MODELS_DIGEST_CACHE = {"at": -1e9, "value": ""}


def _models_digest(max_age_s=30.0):
    """Names and sizes of the model files (nothing is read), so a model that differs between the Macs shows in the fingerprint."""
    now = time.monotonic()
    if now - _MODELS_DIGEST_CACHE["at"] >= max_age_s:
        roots = {"repo": str(Path(__file__).resolve().parents[1]), "local_ai": str(LOCAL_AI_ROOT)}
        _MODELS_DIGEST_CACHE.update(at=now, value=sync_manifest.models_digest(roots, (LOCAL_AI_ROOT / "models/image").is_dir()))
    return _MODELS_DIGEST_CACHE["value"]


_NODE_STATUS_CACHE = {"at": 0.0, "value": None}
_NODE_STATUS_LOCK = threading.Lock()
KIND_BY_PATH = {"/image": "image", "/video": "video", "/tts": "tts", "/tts-aligned": "tts", "/transcribe": "transcribe"}


def node_status_payload(max_age_s=3.0):
    """Everything the main machine's balancer needs to decide whether to hand this Mac some scenes (GET /node-status)."""
    with _NODE_STATUS_LOCK:
        now = time.monotonic()
        if _NODE_STATUS_CACHE["value"] is not None and now - _NODE_STATUS_CACHE["at"] < max_age_s:
            return _NODE_STATUS_CACHE["value"]
        image_state, image_config = image_server_info()
        if image_state == "down" and SLEEPER.asleep("image"):
            image_state = "asleep"  # not broken: it wakes for the next picture, which costs a minute of loading
            image_config = remembered_image_config({})
        elif image_state == "ready":
            image_config = remembered_image_config(image_config)
        comfy_ready, _ = comfyui_state()
        image_models = list(available_image_models())
        engines = tts_engines_up()
        ffmpeg_ready = find_binary("ffmpeg", "FFMPEG_PATH") is not None
        ltx_ready, _ = ltx_state()
        ltx_ok = ltx_ready == "ready" or SLEEPER.asleep("ltx")
        settings = {
            "IMAGE_PRESET": IMAGE_PRESET, "IMAGE_STEPS": IMAGE_STEPS_OVERRIDE or "", "IMAGE_PERSON_STEPS": IMAGE_PERSON_STEPS,
            "VIENEU_STEPS": VIENEU_STEPS, "TTS_BREAK_WORDS": TTS_BREAK_WORDS, "TTS_ENGINES": ",".join(TTS_ENGINES),
            "PACE_TARGET_WPS": PACE_TARGET_WPS, "VIENEU_VOICE": VIENEU_VOICE, "FACE_DETAIL": FACE_DETAIL,
            "IMAGE_ANATOMY_GUARD": IMAGE_ANATOMY_GUARD, "IMAGE_NEGATIVE_PROMPT": IMAGE_NEGATIVE_PROMPT,
            # A machine without the face model draws faces the other machine would have redrawn.
            "FACE_DETAIL_READY": face_detail_state()[0],
            "MODELS_DIGEST": _models_digest(),
            **{f"image_server.{key}": value for key, value in image_config.items()},
        }
        value = {
            "node": NODE_NAME,
            "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "accepting": not node_status.paused(),
            "capabilities": {
                "image": image_state != "down" or comfy_ready == "ready",
                "tts": ffmpeg_ready and bool(engines),
                "transcribe": service_up(WHISPER_URL, "/") or SLEEPER.asleep("whisper"),
                "video": ltx_ok,
            },
            "image": {"state": image_state, "models": image_models, "defaultModel": image_models[0] if image_models else None},
            "tts": {"engines": engines, "defaultEngine": engines[0] if engines else None},
            "resources": node_status.read_resources(),
            "active": METRICS.active(),
            "perf": METRICS.perf(),
            "idleSleep": {"minutes": SLEEPER.idle_s / 60, "services": SLEEPER.snapshot()},
            "fingerprint": node_status.fingerprint(settings, NODE_STATUS_SOURCES),
            # how closely this Mac follows the main one (written by the background sync agent; null on the main Mac and before it is installed)
            "sync": node_status.read_sync_state(),
            # lets the main machine name the setting that differs, instead of only saying that something does
            "settings": settings,
        }
        _NODE_STATUS_CACHE.update(at=now, value=value)
        return value


class Handler(BaseHTTPRequestHandler):
    def _authorised(self):
        """/health stays open (liveness only); everything else needs the node token when one is set."""
        if self.path == "/health" or node_status.token_ok(self.headers.get("Authorization"), NODE_TOKEN):
            return True
        json_response(self, 401, {"error": "Thiếu hoặc sai NODE_TOKEN"})
        return False

    def do_GET(self):
        if not self._authorised():
            return
        if self.path == "/node-status":
            json_response(self, 200, node_status_payload())
            return
        if self.path == "/health":
            comfy_ready, _ = comfyui_state()
            image_ready = image_server_state() != "down" or SLEEPER.asleep("image") or comfy_ready == "ready" or (IMAGE_SCRIPT.is_file() and (LOCAL_AI_ROOT / "models/image").is_dir())
            engines = {"vieneu": service_up(VIENEU_URL) or SLEEPER.asleep("vieneu"), "piper": service_up(PIPER_URL)}
            ffmpeg_ready = find_binary("ffmpeg", "FFMPEG_PATH") is not None
            tts_ready = ffmpeg_ready and any(engines.get(e) for e in TTS_ENGINES)
            transcribe_ready = service_up(WHISPER_URL, "/") or SLEEPER.asleep("whisper")
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
        if not self._authorised():
            return
        if self.path == "/node-control":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                enabled = body.get("enabled")
                if not isinstance(enabled, bool):
                    raise ValueError("enabled phải là boolean")
                if enabled:
                    node_status.set_paused(False)
                    start_local_ai_services()
                    json_response(self, 202, {"ok": True, "enabled": True, "detail": "Đang bật lại các dịch vụ AI local"})
                else:
                    node_status.set_paused(True)
                    stopped = stop_local_ai_services()
                    json_response(self, 200, {"ok": True, "enabled": False, "stopped": stopped,
                                              "detail": "Đã dừng model AI và server Python; giữ media bridge để bật lại từ website"})
            except Exception as error:
                json_response(self, 500, {"error": str(error)})
            return
        if self.path == "/sync-now":
            node_status.request_sync()
            json_response(self, 200, {"ok": True})
            return
        kind = KIND_BY_PATH.get(self.path.split("?")[0])
        started = METRICS.begin(kind) if kind else None
        served = False
        needed = []
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 25 * 1024 * 1024:
                json_response(self, 413, {"error": "Dữ liệu trống hoặc vượt giới hạn 25 MB"})
                return
            body = self.rfile.read(length)
            needed = services_for(self.path, body)
            for name in needed:  # in use from here, so the timer cannot put it back to sleep while it is waking or working
                SLEEPER.touch(name, +1)
            for name in needed:
                if SLEEPER.ensure_awake(name):
                    print(f"[idle-sleep] {name} thức dậy cho {self.path}", flush=True)
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
            served = True
        except ValueError as error:
            json_response(self, 400, {"error": str(error)[:200]})
        except Exception:
            traceback.print_exc()  # the real cause goes to the service log, never to the client
            # Never include a subprocess command (which contains the private script).
            json_response(self, 500, {"error": "Không hoàn thành xử lý media local; kiểm tra máy và thử lại"})
        finally:
            for name in needed:
                SLEEPER.touch(name, -1)
            if kind:
                METRICS.end(kind, started, ok=served)

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
    node_status.require_token_for_host(HOST, NODE_TOKEN, os.getenv("NODE_ALLOW_NO_TOKEN") == "1")
    print(f"Local media server '{NODE_NAME}' listening on {HOST}:{PORT}" + (" (token required)" if NODE_TOKEN else ""), flush=True)
    if SLEEPER.enabled:
        threading.Thread(target=SLEEPER.run, daemon=True).start()
        print(f"Idle sleep: model servers sleep after {SLEEPER.idle_s / 60:.0f} min unused", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
