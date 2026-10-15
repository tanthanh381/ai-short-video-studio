"""Lets the model servers sleep when nothing has used them for a while, and wakes each one when a request needs it.

The Mac mini holds the SDXL image server (5 GB), VieNeu, Whisper, ComfyUI and LTX in RAM all day although a video takes minutes of
work. A sleeping service is a launchd job that was unloaded (`launchctl bootout`): its RAM goes back to the system, and nothing
restarts it, because KeepAlive only applies to loaded jobs. Waking it is `launchctl bootstrap` of its plist, then waiting for its
health check. The state needs no file: a service sleeps when its job is not loaded while its plist is installed.

The bridge (media_server.py) owns the clock: it calls touch() around every request, sleep_idle() from a timer thread, and
ensure_awake() before it hands a request to a server. Standard library only; the launchctl and clock calls are injectable for tests.
"""

import json
import os
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

LAUNCH_AGENTS = Path.home() / "Library" / "LaunchAgents"
DEFAULT_IDLE_MINUTES = 5.0


def configured_idle_seconds(env=None):
    """STUDIO_IDLE_SLEEP_MIN minutes (0 turns it off); a missing or unreadable value means the default."""
    raw = (env if env is not None else os.environ).get("STUDIO_IDLE_SLEEP_MIN", "")
    try:
        minutes = float(raw) if raw.strip() else DEFAULT_IDLE_MINUTES
    except ValueError:
        minutes = DEFAULT_IDLE_MINUTES
    return max(0.0, minutes) * 60.0


class Service:
    def __init__(self, name, label, up, wake_timeout_s=240, idle_cap_s=None, process=None):
        self.name = name
        self.process = process  # ProcessControl, for a Mac that runs this server without launchd (the Air)
        # a rarely used heavy server (video, ComfyUI) sleeps sooner than the limit, never later
        self.idle_cap_s = idle_cap_s
        self.label = label
        self.up = up  # () -> bool: answers its health check
        self.wake_timeout_s = wake_timeout_s


class Launchd:
    """The three launchctl operations, on the current user's GUI domain."""

    def __init__(self, uid=None, agents_dir=None):
        self.domain = f"gui/{uid if uid is not None else os.getuid()}"
        self.agents_dir = Path(agents_dir) if agents_dir else LAUNCH_AGENTS

    def plist(self, label):
        return self.agents_dir / f"{label}.plist"

    def installed(self, label):
        return self.plist(label).is_file()

    def loaded(self, label):
        return subprocess.run(["launchctl", "print", f"{self.domain}/{label}"], capture_output=True, timeout=15).returncode == 0

    def unload(self, label):
        subprocess.run(["launchctl", "bootout", f"{self.domain}/{label}"], capture_output=True, timeout=30)

    def load(self, label):
        result = subprocess.run(["launchctl", "bootstrap", self.domain, str(self.plist(label))], capture_output=True, text=True, timeout=30)
        if result.returncode not in (0, 5):  # 5: already loaded, which is what we wanted
            raise RuntimeError(f"Không bật được dịch vụ {label}: {(result.stderr or '').strip()[:120]}")


def listener_pid(port):
    try:
        out = subprocess.run(["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"], capture_output=True, text=True, timeout=10).stdout.split()
        return int(out[0]) if out else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


class ProcessControl:
    """Sleep and wake for a server that was started by a script (nohup) and not by launchd: sleeping ends its process, waking runs the
    same command again. Which servers were put to sleep is kept in a file, so a crashed server is never mistaken for a sleeping one
    and a bridge restart does not forget them. Same four calls as Launchd; the label is ignored."""

    def __init__(self, name, port, argv, state_file, cwd=None, env=None, log_path=None):
        self.name, self.port, self.argv = name, port, [str(a) for a in argv]
        self.state_file, self.cwd, self.env, self.log_path = Path(state_file), cwd, env, log_path

    def _flags(self):
        try:
            return set(json.loads(self.state_file.read_text()))
        except (OSError, ValueError):
            return set()

    def _set_flag(self, on):
        flags = self._flags()
        flags.add(self.name) if on else flags.discard(self.name)
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(sorted(flags)))
        except OSError:
            pass

    def installed(self, label=None):
        return all(Path(a).exists() for a in self.argv if a.startswith("/"))

    def loaded(self, label=None):
        return port_open(self.port) or self.name not in self._flags()

    def unload(self, label=None):
        self._set_flag(True)
        pid = listener_pid(self.port)
        if not pid or pid == os.getpid():
            return
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        for _ in range(32):
            if listener_pid(self.port) != pid:
                return
            time.sleep(0.25)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def load(self, label=None):
        self._set_flag(False)
        if port_open(self.port):
            return
        log = open(self.log_path, "ab") if self.log_path else subprocess.DEVNULL
        try:
            subprocess.Popen(self.argv, cwd=self.cwd, env=self.env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        finally:
            if log is not subprocess.DEVNULL:
                log.close()


class Sleeper:
    def __init__(self, services, idle_s, launchd=None, clock=time.monotonic, sleep=time.sleep):
        self.services = {s.name: s for s in services}
        self.idle_s = idle_s
        self.launchd = launchd or Launchd()
        self.clock = clock
        self.pause = sleep
        self.lock = threading.Lock()
        self.locks = {name: threading.Lock() for name in self.services}
        # A service counts as just used when the bridge starts: a Mac that was rebooted frees them after the idle time too.
        self.last_used = {name: clock() for name in self.services}
        self.busy = {name: 0 for name in self.services}

    @property
    def enabled(self):
        return self.idle_s > 0

    def touch(self, name, delta=0):
        """Records use of a service; delta +1/-1 brackets a request so a long job is never taken for idleness."""
        if name not in self.services:
            return
        with self.lock:
            self.last_used[name] = self.clock()
            self.busy[name] = max(0, self.busy[name] + delta)

    def control(self, service):
        """launchd when the Mac has a job for it (the Mac mini), otherwise the process control, otherwise launchd (which finds nothing)."""
        if service.process is not None and not self.launchd.installed(service.label):
            return service.process
        return self.launchd

    def asleep(self, name):
        """True for a service that was put to sleep: its job is unloaded although its plist is installed."""
        service = self.services.get(name)
        if not service:
            return False
        control = self.control(service)
        return control.installed(service.label) and not control.loaded(service.label)

    def sleep_idle(self, keep=()):
        """Unloads every service idle for longer than the limit; returns the names put to sleep. `keep` is never touched."""
        if not self.enabled:
            return []
        slept = []
        for name, service in self.services.items():
            with self.lock:
                idle = self.clock() - self.last_used[name]
                busy = self.busy[name]
            limit = min(self.idle_s, service.idle_cap_s) if service.idle_cap_s else self.idle_s
            control = self.control(service)
            if name in keep or busy or idle < limit or not control.installed(service.label):
                continue
            if not self.locks[name].acquire(blocking=False):
                continue
            try:
                if control.loaded(service.label):
                    control.unload(service.label)
                    slept.append(name)
            finally:
                self.locks[name].release()
        return slept

    def ensure_awake(self, name):
        """Starts a sleeping service and waits until it answers; returns True when it had to be woken. Concurrent callers wait together."""
        service = self.services.get(name)
        if not service:
            return False
        with self.locks[name]:
            control = self.control(service)
            if not control.installed(service.label):
                return False
            woke = False
            if not control.loaded(service.label):
                control.load(service.label)
                woke = True
            if woke or not service.up():
                deadline = self.clock() + service.wake_timeout_s
                while not service.up():
                    if self.clock() >= deadline:
                        raise RuntimeError(f"Dịch vụ {name} thức dậy quá lâu; kiểm tra máy và thử lại")
                    self.pause(2)
            self.touch(name)
            return woke

    def snapshot(self):
        """For the dashboard: which services sleep and how long each has been unused."""
        now = self.clock()
        with self.lock:
            idle = {name: round(now - used) for name, used in self.last_used.items()}
        return {name: {"asleep": self.asleep(name), "idleSeconds": idle[name]} for name in self.services}

    def run(self, interval_s=30, keep=lambda: (), stop=None):
        """Timer loop for the bridge's background thread."""
        stop = stop or threading.Event()
        while not stop.wait(interval_s):
            try:
                for name in self.sleep_idle(keep()):
                    print(f"[idle-sleep] {name} ngủ vì {self.idle_s / 60:.0f} phút không dùng", flush=True)
            except Exception as error:  # a failed launchctl call must never stop the timer
                print(f"[idle-sleep] lỗi: {error}", flush=True)
