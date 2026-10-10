"""What a load balancer needs to know before it sends work to this Mac.

Used by media_server.py (GET /node-status) and whiteboard_server.py (token + bind rules). Standard library only, so a
second Mac needs nothing installed beyond what the first one already runs. Every reading degrades to "unknown" instead
of failing: an unreadable value must never make a healthy machine look dead.
"""

import hashlib
import hmac
import ipaddress
import os
import platform
import re
import subprocess
import threading
import time
from pathlib import Path

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
PAUSE_FILE = Path(os.getenv("NODE_PAUSE_FILE", str(Path.home() / ".studio-node-paused")))

# --- token and bind rules -------------------------------------------------------------------------------------------


def is_loopback(host):
    """True when `host` only accepts connections from this machine."""
    if host in LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def require_token_for_host(host, token, allow_open=False):
    """A server reachable from other machines must demand a token; refuse to start otherwise (fail closed)."""
    if is_loopback(host) or token or allow_open:
        return
    raise SystemExit(
        f"Từ chối khởi động: máy chủ bind {host} (mở cho máy khác) nhưng chưa đặt NODE_TOKEN. "
        "Đặt cùng một NODE_TOKEN ở máy này và ở AI_NODES_TOKEN của máy chính, "
        "hoặc đặt NODE_ALLOW_NO_TOKEN=1 nếu mạng đã được cô lập hoàn toàn."
    )


def token_ok(authorization_header, token):
    """No token configured = open (loopback only, see require_token_for_host). Otherwise a constant-time Bearer match."""
    if not token:
        return True
    value = authorization_header or ""
    if not value.startswith("Bearer "):
        return False
    return hmac.compare_digest(value[7:].encode(), token.encode())


# --- readings (pure parsers, so the formats are testable without a Mac) -----------------------------------------------


def parse_pressure_level(text):
    """`sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical."""
    try:
        level = int(str(text).strip())
    except (TypeError, ValueError):
        return "unknown"
    if level >= 4:
        return "critical"
    if level >= 2:
        return "warn"
    return "normal" if level == 1 else "unknown"


def parse_power(text):
    """`pmset -g batt` -> (source, percent). A Mac mini has no battery line: AC power, percent None."""
    if not text:
        return "unknown", None
    source = "unknown"
    lowered = text.lower()
    if "ac power" in lowered:
        source = "ac"
    elif "battery power" in lowered:
        source = "battery"
    match = re.search(r"(\d{1,3})%", text)
    percent = min(100, int(match.group(1))) if match else None
    return source, percent


def parse_thermal(text):
    """`pmset -g thermal`: any *_Limit below 100 means the OS is slowing the CPU down."""
    if not text:
        return "unknown"
    limits = [int(value) for value in re.findall(r"[A-Za-z_]*Limit\s*=\s*(\d+)", text)]
    if any(value < 100 for value in limits):
        return "throttled"
    return "nominal"


def _run(command, timeout=2.0):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _memory_total_gb():
    if platform.system() == "Darwin":
        out = _run(["sysctl", "-n", "hw.memsize"])
        if out and out.strip().isdigit():
            return round(int(out.strip()) / 2**30, 1)
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1)
    except (ValueError, OSError, AttributeError):
        return None


_RESOURCES = {"at": 0.0, "value": None}
_RESOURCES_LOCK = threading.Lock()


def read_resources(max_age_s=4.0):
    """Cached for a few seconds: the balancer probes often and each reading spawns a short process."""
    with _RESOURCES_LOCK:
        now = time.monotonic()
        if _RESOURCES["value"] is not None and now - _RESOURCES["at"] < max_age_s:
            return _RESOURCES["value"]
        mac = platform.system() == "Darwin"
        pressure = parse_pressure_level(_run(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"])) if mac else "unknown"
        power, percent = parse_power(_run(["pmset", "-g", "batt"])) if mac else ("unknown", None)
        thermal = parse_thermal(_run(["pmset", "-g", "therm"])) if mac else "unknown"
        try:
            load = round(os.getloadavg()[0], 2)
        except (OSError, AttributeError):
            load = None
        value = {
            "cpuCores": os.cpu_count(),
            "memTotalGb": _memory_total_gb(),
            "memPressure": pressure,
            "loadAvg1": load,
            "power": power,
            "batteryPercent": percent,
            "thermal": thermal,
        }
        _RESOURCES.update(at=now, value=value)
        return value


def paused(path=None):
    """The owner of a personal laptop can stop it taking work with `touch ~/.studio-node-paused`."""
    return Path(path or PAUSE_FILE).exists()


# --- what this node has done lately ----------------------------------------------------------------------------------


class Metrics:
    """Per-kind exponentially weighted duration of the requests this node served (seeds the balancer's estimates)."""

    ALPHA = 0.4

    def __init__(self):
        self._lock = threading.Lock()
        self._ewma = {}
        self._active = {}

    def begin(self, kind):
        with self._lock:
            self._active[kind] = self._active.get(kind, 0) + 1
        return time.monotonic()

    def end(self, kind, started, ok=True):
        elapsed_ms = (time.monotonic() - started) * 1000
        with self._lock:
            self._active[kind] = max(0, self._active.get(kind, 1) - 1)
            if ok:  # a request that failed early says nothing about how long a real one takes
                previous = self._ewma.get(kind)
                self._ewma[kind] = elapsed_ms if previous is None else previous + self.ALPHA * (elapsed_ms - previous)

    def perf(self):
        with self._lock:
            return {kind: round(value) for kind, value in self._ewma.items()}

    def active(self):
        with self._lock:
            return {kind: count for kind, count in self._active.items() if count}


# --- parity between machines ----------------------------------------------------------------------------------------


def fingerprint(settings, source_files):
    """Short hash of the settings and code that decide how a picture or a voice comes out.

    Two machines with the same fingerprint make interchangeable scenes; with different ones, half of a video would look
    or sound different from the other half, so the balancer keeps such a machine away from the media lanes.
    """
    digest = hashlib.sha256()
    for key in sorted(settings):
        digest.update(f"{key}={settings[key]}\n".encode())
    for path in source_files:
        try:
            digest.update(Path(path).read_bytes())
        except OSError:
            digest.update(b"?")
    return digest.hexdigest()[:12]
