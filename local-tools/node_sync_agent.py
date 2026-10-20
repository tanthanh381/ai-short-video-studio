"""Keeps this Mac (the second machine) compatible with the main one: the studio's programs and toolkit are shared, while
model files and Ollama models may remain machine-specific. Runs in the background under launchd (a LaunchAgent the installer sets up) and does this every minute:

  1. asks the main Mac (node_sync_server.py) for its manifest and compares it with what is here;
  2. downloads what is missing or different, a file at a time, with a sha256 check, so a cut download goes on where it stopped;
  3. restarts only the programs whose files changed, and only when nothing is being made on this Mac;
  4. writes ~/.studio-sync-state.json, which the media bridge reports and the Hệ thống page shows;
  5. keeps this Mac's own programs running: when the media bridge, Ollama, Whisper, the picture or voice server or the hand-drawing
     server is down (after a restart of the Mac, a crash, an update), it starts them again with scripts/Mo-May-Phu.command.

Nothing is ever deleted. Big model downloads wait while the Mac runs on battery; nothing is replaced while it is making a picture
or a voice. `node_sync_agent.py now|pause|resume|status|once` is for the person at this Mac. Standard library only.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import sync_manifest

AGENT_VERSION = 1
CHECK_EVERY_S = 60
TICK_S = 5
MIN_FREE_GB_AFTER = 3
BACKUPS_KEPT = 5
RECOVERY_WAIT_S = 180  # between two attempts to start what is down; doubles after each failed attempt, up to 8x
BRIDGE = "cầu nối media"
BRIDGE_MISSES_BEFORE_RESTART = 2


class Paths:
    """Where the agent keeps its files: all in the home folder, so a test can point them at a temporary one."""

    def __init__(self, home=None):
        self.home = Path(home or os.environ.get("STUDIO_SYNC_HOME") or Path.home())
        self.config = self.home / ".studio-sync.json"
        self.state = self.home / ".studio-sync-state.json"
        self.paused = self.home / ".studio-sync-paused"
        self.trigger = self.home / ".studio-sync-now"
        self.token = self.home / ".studio-node-token"
        self.cache = self.home / ".studio-sync-cache.json"
        self.backups = self.home / ".studio-sync-backups"


def hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    tmp = Path(f"{path}.tmp")
    tmp.write_text(json.dumps(value))
    os.replace(tmp, path)


class SyncError(Exception):
    pass


class Agent:
    def __init__(self, config, token, paths=None, *, opener=urllib.request.urlopen, restart=None, is_idle=None, power=None, pull=None, services_down=None, start_services=None, now=time.time, log=print):
        self.config = config
        self.token = token
        self.paths = paths or Paths()
        self.open = opener
        self.now = now
        self.log = log
        self.roots = {"repo": config["repo"], "local_ai": config["localAi"]}
        self.with_image = bool(config.get("image", False))
        # Heterogeneous nodes are intentional: share code/toolkit, choose models per node.
        self.sync_models = bool(config.get("syncModels", False))
        self.sync_ollama = bool(config.get("syncOllama", False))
        self.cache = sync_manifest.HashCache(self.paths.cache)
        self.restart = restart or self._restart_services
        self.is_idle = is_idle or self._bridge_idle
        self.power = power or self._power
        self.pull = pull or self._ollama_pull
        self.services_down = services_down or self._services_down
        self.start_services = start_services or self._start_all
        self.recovery = {"count": 0, "lastAt": None, "down": []}
        self.recovery_failures = 0
        self.bridge_misses = 0
        self.last_recovery_try = -1e9
        self.pending_restart = set()
        self.applied_at = None
        self.last_state = {}

    # --- talking to the main machine --------------------------------------------------------------------------------------

    def _request(self, path, headers=None, timeout=30):
        request = urllib.request.Request(self.config["source"].rstrip("/") + path, headers={"Authorization": f"Bearer {self.token}", **(headers or {})})
        return self.open(request, timeout=timeout)

    def fetch_manifest(self):
        try:
            with self._request("/manifest") as reply:
                return json.load(reply)
        except urllib.error.HTTPError as error:
            raise SyncError("Mac mini từ chối mã truy cập" if error.code == 401 else f"Mac mini trả lỗi {error.code}")
        except (OSError, ValueError) as error:
            raise SyncError(f"Không liên lạc được với Mac mini ({type(error).__name__})")

    def download(self, key, entry, on_bytes):
        """Fetches one file to a '.sync-part' next to its place (going on from what is already there), checks it, then moves it into place."""
        dest = sync_manifest.resolve(self.roots, key)
        if dest is None:
            raise SyncError(f"Đường dẫn không hợp lệ: {key}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = Path(f"{dest}.sync-part")
        have = part.stat().st_size if part.exists() else 0
        if have >= entry["size"] and entry["size"] > 0:
            part.unlink()
            have = 0
        url_path = f"/file?key={urllib.parse.quote(key, safe='/')}"
        try:
            with self._request(url_path, {"Range": f"bytes={have}-"} if have else {}, timeout=60) as reply:
                if have and getattr(reply, "status", 200) == 200:  # the server ignored the range: start over
                    have = 0
                with open(part, "ab" if have else "wb") as out:
                    while True:
                        chunk = reply.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        on_bytes(len(chunk))
        except urllib.error.HTTPError as error:
            raise SyncError(f"Mac mini không gửi được {key} ({error.code})")
        except OSError as error:
            raise SyncError(f"Tải {key} bị gián đoạn ({type(error).__name__}); sẽ tiếp tục ở lần sau")
        if os.path.getsize(part) != entry["size"] or hash_file(part) != entry["sha256"]:
            part.unlink(missing_ok=True)
            raise SyncError(f"Tệp {key} tải về không khớp mã kiểm tra; sẽ tải lại")
        os.chmod(part, 0o755 if entry.get("exec") else 0o644)
        return part, dest

    # --- what is here -----------------------------------------------------------------------------------------------------

    def local_ollama(self):
        try:
            with self.open(urllib.request.Request(self.config["ollama"].rstrip("/") + "/api/tags"), timeout=5) as reply:
                return {m["name"]: m.get("digest", "") for m in json.load(reply).get("models", []) if m.get("name")}
        except (OSError, ValueError, KeyError):
            return None  # Ollama is not running: nothing to compare, nothing to pull

    def ollama_gaps(self, expected):
        here = self.local_ollama()
        if here is None:
            return []
        return [m["name"] for m in expected if m["name"] not in here or (m.get("digest") and here[m["name"]] and m["digest"] != here[m["name"]])]

    def _ollama_pull(self, name):
        body = json.dumps({"name": name, "stream": False}).encode()
        request = urllib.request.Request(self.config["ollama"].rstrip("/") + "/api/pull", data=body, headers={"Content-Type": "application/json"}, method="POST")
        with self.open(request, timeout=3600) as reply:
            reply.read()

    def _power(self):
        if sys.platform != "darwin":
            return "ac", None
        try:
            import node_status
            out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=3)
            return node_status.parse_power(out.stdout)
        except (OSError, subprocess.SubprocessError, ImportError):
            return "unknown", None

    def _bridge_idle(self):
        """True when this Mac is not making a picture or a voice for the main one (or its bridge is not running at all)."""
        bridge = self.config.get("bridge")
        if not bridge:
            return True
        try:
            request = urllib.request.Request(bridge.rstrip("/") + "/node-status", headers={"Authorization": f"Bearer {self.token}"})
            with self.open(request, timeout=4) as reply:
                return not json.load(reply).get("active")
        except (OSError, ValueError):
            return True

    def _restart_services(self, services):
        for name in sorted(services - {"agent"}):
            pattern = sync_manifest.SERVICE_PATTERNS.get(name)
            if pattern:
                subprocess.run(["pkill", "-f", pattern], check=False)
        time.sleep(2)
        self._start_all()

    def _start_all(self):
        """scripts/Mo-May-Phu.command starts every program that is not running (and leaves the running ones alone)."""
        repo = Path(self.roots["repo"])
        log_dir = repo / "tmp" / "local-services"
        log_dir.mkdir(parents=True, exist_ok=True)
        with open(log_dir / "sync-restart.log", "ab") as out:
            subprocess.Popen(["/bin/zsh", str(repo / "scripts" / "Mo-May-Phu.command")], cwd=repo, stdout=out, stderr=out, start_new_session=True,
                             env={**os.environ, "NODE_NAME": self.config.get("node", "air"), "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"})

    def _services_down(self):
        """Names of this Mac's programs that do not answer: the media bridge itself, and what it says about Ollama, Whisper, pictures, voices."""
        bridge = self.config.get("bridge")
        if not bridge:
            return []
        down = []
        try:
            with self.open(urllib.request.Request(bridge.rstrip("/") + "/health"), timeout=12) as reply:
                health = json.load(reply)
            for key, name in (("ollama", "Ollama"), ("transcribe", "Whisper"), ("image", "máy vẽ ảnh"), ("tts", "giọng đọc")):
                if health.get(key) is False:
                    down.append(name)
        except (OSError, ValueError):
            down.append(BRIDGE)
        whiteboard = self.config.get("whiteboard")
        if whiteboard:
            try:
                with self.open(urllib.request.Request(whiteboard.rstrip("/") + "/health"), timeout=5):
                    pass
            except (OSError, ValueError):
                down.append("máy vẽ tay")
        return down

    def supervise(self):
        """Starts what is down, without looping on a program that will not start: the wait doubles after each failed attempt."""
        if self.paths.paused.exists():
            return
        down = self.services_down()
        # A bridge that missed one check is usually only slow (the Mac is paging); restarting for that alarms the owner for
        # nothing. It counts as down once two checks in a row failed.
        if BRIDGE in down:
            self.bridge_misses += 1
            if self.bridge_misses < BRIDGE_MISSES_BEFORE_RESTART:
                down = [name for name in down if name != BRIDGE]
        else:
            self.bridge_misses = 0
        self.recovery["down"] = down
        if not down:
            self.recovery_failures = 0
        elif self.now() - self.last_recovery_try >= RECOVERY_WAIT_S * 2 ** min(self.recovery_failures, 3):
            self.last_recovery_try = self.now()
            self.log(f"[node-sync-agent] đang tắt: {', '.join(down)}; khởi động lại")
            try:
                self.start_services()
            except OSError as error:
                self.log(f"[node-sync-agent] không khởi động được: {error}")
            self.recovery["count"] += 1
            self.recovery["lastAt"] = self.now()
            self.recovery_failures += 1
        self._patch_state(recovery=dict(self.recovery))

    def _patch_state(self, **fields):
        if self.last_state:
            self.last_state = {**self.last_state, **fields}
            write_json(self.paths.state, self.last_state)

    # --- state ------------------------------------------------------------------------------------------------------------

    def write_state(self, state, **fields):
        value = {
            "state": state, "checkedAt": self.now(), "appliedAt": self.applied_at, "agentVersion": AGENT_VERSION, "pid": os.getpid(),
            "behind": {"code": 0, "toolkit": 0, "models": 0, "ollama": 0}, "differences": [], "error": None, "restartPending": sorted(self.pending_restart),
            "progress": None, "sourceVersion": None, "localVersion": None, "recovery": dict(self.recovery), **fields,
        }
        write_json(self.paths.state, value)
        self.last_state = value
        return value

    # --- one round --------------------------------------------------------------------------------------------------------

    def cycle(self):
        """Compares with the main machine and brings this one in line. Returns the state it wrote (also in the state file)."""
        self.write_state("syncing", progress={"doneBytes": 0, "totalBytes": 0, "label": "Đang so sánh với Mac mini"}, error=None)
        try:
            manifest = self.fetch_manifest()
        except SyncError as error:
            return self.write_state("error", error=str(error))
        expected = manifest["entries"]
        local = sync_manifest.scan(self.roots, self.with_image, self.cache)
        if not self.sync_models:
            expected = {key: entry for key, entry in expected.items() if sync_manifest.group_of(key) != "models"}
            local = sync_manifest.scan(self.roots, False, self.cache)
        gaps = sync_manifest.diff(expected, local, self.sync_models and self.with_image)
        todo = gaps["missing"] + gaps["changed"]
        wanted = {k: v for k, v in expected.items() if self.sync_models and (self.with_image or not k.startswith(f"models/{sync_manifest.IMAGE_DIR}/")) or not self.sync_models}
        pulls = self.ollama_gaps(manifest.get("ollama", [])) if self.sync_ollama else []
        # compared like with like: the main machine's files that belong on this one (a Mac without the picture model never has those)
        source_version = sync_manifest.version_of(wanted)
        notes = []

        source, percent = self.power()
        defer_models = source == "battery"
        models_todo = [k for k in todo if sync_manifest.group_of(k) == "models"]
        if defer_models and models_todo:
            notes.append("Đang dùng pin: hoãn tải model cho tới khi cắm điện")
            todo = [k for k in todo if sync_manifest.group_of(k) != "models"]
            pulls = []
        needed = sync_manifest.bytes_of(expected, todo)
        free = shutil.disk_usage(self.roots["local_ai"] if os.path.isdir(self.roots["local_ai"]) else self.roots["repo"]).free
        errors = []
        if needed and free < needed + MIN_FREE_GB_AFTER * 2**30:
            errors.append(f"Không đủ chỗ trống để tải {needed / 2**30:.1f} GB (còn {free / 2**30:.1f} GB)")
            todo = [k for k in todo if sync_manifest.group_of(k) != "models"]
            needed = sync_manifest.bytes_of(expected, todo)

        changed = []
        done = {"bytes": 0}
        order = sorted(todo, key=lambda k: ({"code": 0, "toolkit": 1, "models": 2}.get(sync_manifest.group_of(k), 3), expected[k].get("size", 0)))
        backup_dir = self.paths.backups / time.strftime("%Y%m%d-%H%M%S", time.localtime(self.now()))
        last_write = [0.0]

        def progress(label):
            def on_bytes(count):
                done["bytes"] += count
                if time.monotonic() - last_write[0] > 2:
                    last_write[0] = time.monotonic()
                    self.write_state("syncing", progress={"doneBytes": done["bytes"], "totalBytes": needed, "label": label}, behind=self._behind(todo), sourceVersion=source_version)
            return on_bytes

        for key in order:
            entry = expected[key]
            try:
                if entry["kind"] == "symlink":
                    dest = sync_manifest.resolve(self.roots, key)
                    if dest is None:
                        raise SyncError(f"Đường dẫn không hợp lệ: {key}")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if os.path.lexists(dest):
                        os.remove(dest)
                    os.symlink(entry["target"], dest)
                else:
                    part, dest = self.download(key, entry, progress(sync_manifest.describe_key(key)))
                    if sync_manifest.group_of(key) != "models" and dest.exists():
                        backup = backup_dir / key
                        backup.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(dest, backup)
                    os.replace(part, dest)
                changed.append(key)
            except SyncError as error:
                errors.append(str(error))
                self.log(f"[node-sync-agent] {error}")
        self._prune_backups()

        for name in pulls:
            self.write_state("syncing", progress={"doneBytes": done["bytes"], "totalBytes": needed, "label": f"Đang tải model Ollama {name}"}, behind=self._behind(todo, pulls), sourceVersion=source_version)
            try:
                self.pull(name)
            except (OSError, ValueError) as error:
                errors.append(f"Không tải được model Ollama {name} ({type(error).__name__})")

        if changed:
            self.applied_at = self.now()
            self.pending_restart |= sync_manifest.services_for(changed)
        restarted = []
        if self.pending_restart - {"agent"}:
            if self.is_idle():
                services = self.pending_restart - {"agent"}
                self.restart(services)
                restarted = sorted(services)
                self.pending_restart -= services
            else:
                notes.append("Chờ máy rảnh để khởi động lại dịch vụ đã cập nhật")

        after = sync_manifest.scan(self.roots, self.sync_models and self.with_image, self.cache)
        left = sync_manifest.diff(expected, after, self.sync_models and self.with_image)
        left_keys = left["missing"] + left["changed"]
        gaps_after = self._behind(left_keys, self.ollama_gaps(manifest.get("ollama", [])) if self.sync_ollama and not defer_models else [])
        version_here = sync_manifest.version_of({k: after[k] for k in wanted if k in after})
        in_sync = not left_keys and not gaps_after["ollama"] and not errors and not (defer_models and models_todo)
        descriptions = [sync_manifest.describe_key(k) for k in left_keys[:8]] + [f"Model Ollama {name}" for name in (self.ollama_gaps(manifest.get("ollama", [])) if self.sync_ollama else [])[:4]]
        state = self.write_state(
            "in-sync" if in_sync else "behind",
            sourceVersion=source_version, localVersion=version_here, behind=gaps_after, differences=(notes + descriptions)[:10],
            error="; ".join(errors)[:300] if errors else None,
        )
        if restarted:
            state["restarted"] = restarted
        return state

    def _behind(self, keys, pulls=()):
        counts = {"code": 0, "toolkit": 0, "models": 0, "ollama": len(pulls)}
        for key in keys:
            counts[sync_manifest.group_of(key)] = counts.get(sync_manifest.group_of(key), 0) + 1
        return counts

    def _prune_backups(self):
        if not self.paths.backups.exists():
            return
        for old in sorted(self.paths.backups.iterdir())[:-BACKUPS_KEPT]:
            shutil.rmtree(old, ignore_errors=True)

    # --- the loop ---------------------------------------------------------------------------------------------------------

    def run_forever(self, sleep=time.sleep, max_ticks=None):
        """Looks every minute, or at once when asked (`now`). Returns when the agent itself was updated: launchd starts the new one."""
        next_check = 0.0
        ticks = 0
        while max_ticks is None or ticks < max_ticks:
            ticks += 1
            if self.paths.paused.exists():
                self.write_state("paused", error=None, sourceVersion=self.last_state.get("sourceVersion"), localVersion=self.last_state.get("localVersion"), behind=self.last_state.get("behind") or {"code": 0, "toolkit": 0, "models": 0, "ollama": 0})
            else:
                triggered = self.paths.trigger.exists()
                if triggered or self.now() >= next_check:
                    if triggered:
                        self.paths.trigger.unlink(missing_ok=True)
                    try:
                        self.cycle()
                    except Exception as error:  # a bug or a full disk must not stop the loop: it is reported and tried again
                        self.log(f"[node-sync-agent] {type(error).__name__}: {error}")
                        self.write_state("error", error=f"Lỗi không mong đợi: {type(error).__name__}")
                    try:
                        self.supervise()
                    except Exception as error:  # watching the programs must never stop the sync
                        self.log(f"[node-sync-agent] giám sát dịch vụ lỗi: {type(error).__name__}: {error}")
                    next_check = self.now() + CHECK_EVERY_S
                    if "agent" in self.pending_restart:
                        self.log("[node-sync-agent] chương trình đồng bộ vừa được cập nhật; khởi động lại để dùng bản mới")
                        return "restart"
            sleep(TICK_S)
        return "stopped"


def load_agent(paths=None):
    paths = paths or Paths()
    config = json.loads(paths.config.read_text())
    token = paths.token.read_text().strip()
    return Agent(config, token, paths)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command = argv[0] if argv else "run"
    paths = Paths()
    if command == "now":
        paths.trigger.touch()
        print("Đã yêu cầu đồng bộ ngay; trong vài giây tiến trình nền sẽ chạy.")
    elif command == "pause":
        paths.paused.touch()
        print("Đã tạm dừng đồng bộ (bật lại: resume).")
    elif command == "resume":
        paths.paused.unlink(missing_ok=True)
        paths.trigger.touch()
        print("Đã bật lại đồng bộ.")
    elif command == "status":
        print(paths.state.read_text() if paths.state.exists() else "Chưa có trạng thái: tiến trình nền chưa chạy.")
    elif command == "once":
        print(json.dumps(load_agent(paths).cycle(), ensure_ascii=False, indent=1))
    elif command == "run":
        agent = load_agent(paths)
        agent.log("[node-sync-agent] bắt đầu")
        agent.run_forever()
    else:
        sys.exit("dùng: node_sync_agent.py [run|once|now|pause|resume|status]")


if __name__ == "__main__":
    main()
