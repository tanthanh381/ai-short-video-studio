"""What the main Mac and a second Mac keep identical, and how to tell when they are not.

Shared by the server on the main machine (node_sync_server.py) and the agent on the second one (node_sync_agent.py), so both
apply the same rules to the same three groups of files:

  code     the studio's own programs: local-tools/** and scripts/Mo-May-Phu.command (under the repository folder)
  toolkit  the voice and Whisper start scripts and servers that live outside git (under the local-ai folder)
  models   Whisper, voices, the face model and, on a Mac that makes pictures, the SDXL-Turbo files (under local-ai/models)

Nothing here is ever deleted: a file that only one machine has is left alone. Standard library only.
"""

import hashlib
import json
import os
import threading
from pathlib import Path

CODE_SKIP_DIRS = {"__pycache__", "tests", ".pytest_cache", "node_modules", ".git"}
# Programs that only the main machine runs (they serve the others) are not copied to them.
CODE_SKIP_FILES = {"air_bundle_server.py", "node_sync_server.py", ".DS_Store"}
CODE_EXTRA_FILES = ["scripts/Mo-May-Phu.command"]
TOOLKIT_FILES = ["bin/env.sh", "bin/start-tts.sh", "bin/start-vieneu.sh", "bin/start-whisper.sh", "vieneu_api.py", "vieneu_tts.py", "tts_api.py"]
MODEL_DIRS = ["whisper", "piper", "vieneu-v3-turbo", "moss-audio-tokenizer-onnx", "face"]
IMAGE_DIR = "image"
# Runtime leftovers inside the model folders: logs, lock files, markers. Not part of a model.
MODEL_SKIP_DIRS = {".locks", "xet", ".no_exist", "__pycache__"}
MODEL_SKIP_NAMES = {".DS_Store", ".agent_harnesses.json", "CACHEDIR.TAG"}
MODEL_SKIP_SUFFIXES = (".lock", ".incomplete", ".part", ".sync-part")
EXECUTABLE_SUFFIXES = (".sh", ".command")


def group_of(key):
    return key.split("/", 1)[0]


def roots_dir(roots, group):
    """The folder a group's keys are relative to."""
    return roots["repo"] if group == "code" else roots["local_ai"]


def _is_code_file(name):
    return name not in CODE_SKIP_FILES and not name.startswith("test_") and not name.endswith((".pyc", ".mjs"))


def _model_skip_file(name):
    return name in MODEL_SKIP_NAMES or name.endswith(MODEL_SKIP_SUFFIXES)


def iter_keys(roots, with_image):
    """(key, absolute path) of every file and symlink that belongs to the sync set, in a stable order."""
    repo, local_ai = Path(roots["repo"]), Path(roots["local_ai"])
    found = []

    code_root = repo / "local-tools"
    for base, dirs, files in os.walk(code_root):
        dirs[:] = sorted(d for d in dirs if d not in CODE_SKIP_DIRS)
        for name in sorted(files):
            if _is_code_file(name):
                path = Path(base) / name
                found.append((f"code/{path.relative_to(repo).as_posix()}", path))
    for relative in CODE_EXTRA_FILES:
        if (repo / relative).exists():
            found.append((f"code/{relative}", repo / relative))

    for relative in TOOLKIT_FILES:
        if (local_ai / relative).exists():
            found.append((f"toolkit/{relative}", local_ai / relative))

    for name in MODEL_DIRS + ([IMAGE_DIR] if with_image else []):
        root = local_ai / "models" / name
        for base, dirs, files in os.walk(root):  # symlinked folders are listed in `dirs` and not followed
            kept = []
            for directory in sorted(dirs):
                full = Path(base) / directory
                if directory in MODEL_SKIP_DIRS:
                    continue
                if full.is_symlink():
                    found.append((f"models/{full.relative_to(local_ai / 'models').as_posix()}", full))
                else:
                    kept.append(directory)
            dirs[:] = kept
            for file_name in sorted(files):
                if _model_skip_file(file_name):
                    continue
                path = Path(base) / file_name
                found.append((f"models/{path.relative_to(local_ai / 'models').as_posix()}", path))
    return found


class HashCache:
    """sha256 of files, remembered by (size, modified time) so a scan only reads what changed. Optionally kept in a file."""

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.lock = threading.Lock()
        self.items = {}
        if self.path and self.path.exists():
            try:
                self.items = json.loads(self.path.read_text())
            except (OSError, ValueError):
                self.items = {}

    def sha256(self, path):
        stat = os.stat(path)
        key = str(path)
        with self.lock:
            cached = self.items.get(key)
            if cached and cached[0] == stat.st_size and cached[1] == stat.st_mtime_ns:
                return cached[2]
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        value = digest.hexdigest()
        with self.lock:
            self.items[key] = [stat.st_size, stat.st_mtime_ns, value]
        return value

    def save(self):
        if not self.path:
            return
        with self.lock:
            text = json.dumps(self.items)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(text)
        os.replace(tmp, self.path)


def entry_for(path, cache):
    """The manifest entry of one file or symlink."""
    if os.path.islink(path):
        return {"kind": "symlink", "target": os.readlink(path)}
    stat = os.stat(path)
    return {"kind": "file", "size": stat.st_size, "sha256": cache.sha256(path), "exec": bool(stat.st_mode & 0o100) if str(path).endswith(EXECUTABLE_SUFFIXES) else False}


def scan(roots, with_image, cache):
    """{key: entry} for everything that belongs to the sync set on this machine."""
    entries = {}
    for key, path in iter_keys(roots, with_image):
        try:
            entries[key] = entry_for(path, cache)
        except OSError:
            continue  # vanished while scanning (a download that was finishing): the next scan sees it
    cache.save()
    return entries


def version_of(entries):
    """A short fingerprint of a set of entries: equal on two machines exactly when the files are the same."""
    digest = hashlib.sha256()
    for key in sorted(entries):
        entry = entries[key]
        digest.update(f"{key}\0{entry['kind']}\0{entry.get('sha256') or entry.get('target')}\0{int(entry.get('exec', False))}\n".encode())
    return digest.hexdigest()[:12]


def same_entry(expected, local):
    if expected["kind"] != local.get("kind"):
        return False
    if expected["kind"] == "symlink":
        return expected["target"] == local.get("target")
    return expected["sha256"] == local.get("sha256") and bool(expected.get("exec")) == bool(local.get("exec"))


def diff(expected, local, with_image):
    """What this machine lacks or has different, among the files it is supposed to have: {"missing": [...], "changed": [...], "same": n}."""
    wanted = {key: entry for key, entry in expected.items() if with_image or not key.startswith(f"models/{IMAGE_DIR}/")}
    missing = sorted(key for key in wanted if key not in local)
    changed = sorted(key for key in wanted if key in local and not same_entry(wanted[key], local[key]))
    return {"missing": missing, "changed": changed, "same": len(wanted) - len(missing) - len(changed)}


def bytes_of(entries, keys):
    return sum(entries[key].get("size", 0) for key in keys if entries[key]["kind"] == "file")


def describe_key(key):
    """A short name for a file in messages: 'Mã media_server.py', 'Model image/…/model.safetensors'."""
    group, _, rest = key.partition("/")
    label = {"code": "Mã", "toolkit": "Bộ công cụ", "models": "Model"}.get(group, group)
    name = rest.removeprefix("local-tools/")
    if group == "models" and len(name) > 60:
        parts = name.split("/")
        name = f"{parts[0]}/…/{parts[-1]}"
    return f"{label} {name}"


# Which program has to be restarted for a changed file to take effect. "agent" is the sync agent itself (it exits and launchd starts it again).
SERVICE_PATTERNS = {
    "media": "local-tools/media_server.py",
    "ltx": "local-tools/ltx_server.py",
    "image": "local-tools/image_server.py",
    "whiteboard": "local-tools/whiteboard_server.py",
    "vieneu": "vieneu_api:app",
    "piper": "tts_api:app",
    "whisper": "whisper-server",
}


def services_for(keys):
    services = set()
    for key in keys:
        name = key.split("/")[-1]
        if key.startswith("code/local-tools/"):
            if name in ("node_sync_agent.py", "sync_manifest.py"):
                services.add("agent")
            elif name == "image_server.py":
                services.add("image")
            elif name == "whiteboard_server.py" or "/whiteboard/" in key:
                services.add("whiteboard")
            elif name in ("media_server.py", "node_status.py", "face_detail.py"):
                services.add("media")
            elif name == "ltx_server.py":
                services.add("ltx")
        elif key.startswith("toolkit/"):
            if name in ("vieneu_api.py", "vieneu_tts.py", "start-vieneu.sh"):
                services.add("vieneu")
            elif name in ("tts_api.py", "start-tts.sh"):
                services.add("piper")
            elif name == "start-whisper.sh":
                services.add("whisper")
            elif name == "env.sh":
                services.update({"vieneu", "piper", "whisper"})
        elif key.startswith("models/"):
            folder = key.split("/")[1]
            services.add({"image": "image", "whisper": "whisper", "piper": "piper", "vieneu-v3-turbo": "vieneu", "moss-audio-tokenizer-onnx": "vieneu", "face": "media"}.get(folder, "media"))
    return services


def resolve(roots, key):
    """The absolute path a manifest key refers to, or None when the key is not inside its group's folder (a crafted '../')."""
    group, _, rest = key.partition("/")
    if group not in ("code", "toolkit", "models") or not rest or rest.startswith("/") or ".." in rest.split("/"):
        return None
    base = Path(roots_dir(roots, group))
    if group == "models":
        base = base / "models"
    path = base / rest
    # a symlink is judged by where it sits, not where it points; a regular file must really be inside the folder
    parent = os.path.realpath(path.parent)
    if parent != os.path.realpath(base) and not parent.startswith(os.path.realpath(base) + os.sep):
        return None
    return path


def models_digest(roots, with_image):
    """A cheap digest of the model files in use (names and sizes, nothing is read): the pictures and voices depend on them, so two
    machines whose model files differ must not share a video. It goes into the media bridge's fingerprint.

    HuggingFace keeps every file once under blobs/ and points at it from snapshots/: only the pointers and the sizes of what they
    point at count, so an old blob nobody uses any more (the other Mac keeps one after a clean-up) does not separate the two.
    A pointer that leads nowhere (a download that was cut) counts too, as a size no real file has.
    """
    digest = hashlib.sha256()
    for key, path in iter_keys(roots, with_image):
        if not key.startswith("models/") or "/blobs/" in key:
            continue
        try:
            size = os.stat(path).st_size  # follows a symlink to the real file
        except OSError:
            size = -1
        digest.update(f"{key}\0{size}\n".encode())
    return digest.hexdigest()[:12]
