"""Checks for the machine-state readings and the token rules a second Mac depends on.

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
The macOS command outputs below are samples of the real formats; parsing them is all that runs here.
"""

import importlib.util
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import node_status

HERE = Path(__file__).resolve().parent


def load_media_server():
    spec = importlib.util.spec_from_file_location("studio_media_server_node", HERE / "media_server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BATTERY_AC = """Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t87%; charging; 0:42 remaining present: true
"""
BATTERY_DISCHARGING = """Now drawing from 'Battery Power'
 -InternalBattery-0 (id=4653155)\t23%; discharging; 1:05 remaining present: true
"""
MINI_AC = """Now drawing from 'AC Power'
"""
THERMAL_NOMINAL = """Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
"""
THERMAL_THROTTLED = """CPU_Scheduler_Limit	= 100
CPU_Available_CPUs	= 8
CPU_Speed_Limit 	= 72
"""


VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     6404.
Pages active:                                 214944.
Pages inactive:                               212986.
Pages speculative:                               857.
Pages throttled:                                   0.
Pages wired down:                             197653.
"""
SWAPUSAGE = "total = 9216.00M  used = 8195.62M  free = 1020.38M  (encrypted)"
PS_LISTING = """  101 13136 /Users/x/Developer/local-ai/venv/bin/python local-tools/image_server.py
  102 195664 /opt/homebrew/Cellar/ollama/0.35.1_1/libexec/lib/ollama/llama-server --model /Users/x/.ollama/models/blobs/sha256-a9d0
  103 566832 /System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com
  104 4096 /opt/homebrew/bin/ffmpeg -i in.mp4 out.mp4
  105 2048 /Applications/Claude.app/Contents/MacOS/Claude
  106 1024 /opt/homebrew/bin/python3.12 local-tools/media_server.py
  not a process line
"""
TOP_MEMORY = """Processes: 400 total, 3 running
PID    MEM
101    4054M
102    3.2G
103    3087M
104    980K
"""


class ParserTests(unittest.TestCase):
    def test_memory_pressure_levels(self):
        self.assertEqual(node_status.parse_pressure_level("1\n"), "normal")
        self.assertEqual(node_status.parse_pressure_level("2"), "warn")
        self.assertEqual(node_status.parse_pressure_level("4"), "critical")
        self.assertEqual(node_status.parse_pressure_level("garbage"), "unknown")
        self.assertEqual(node_status.parse_pressure_level(None), "unknown")

    def test_memory_in_use_counts_what_is_not_free_or_reclaimable(self):
        # 16 GB, of which (6404 + 212986 + 857) pages of 16 KiB are free or cache: about 3.4 GB
        self.assertEqual(node_status.parse_vm_stat(VM_STAT, 16.0), 12.6)
        self.assertIsNone(node_status.parse_vm_stat("", 16.0))
        self.assertIsNone(node_status.parse_vm_stat("nothing useful", 16.0))
        self.assertIsNone(node_status.parse_vm_stat(VM_STAT, None))

    def test_swap_in_gigabytes(self):
        self.assertEqual(node_status.parse_swap(SWAPUSAGE), (8.0, 9.0))
        self.assertEqual(node_status.parse_swap("total = 2.00G  used = 512.00M  free = 1.50G"), (0.5, 2.0))
        self.assertEqual(node_status.parse_swap(None), (None, None))

    def test_footprint_from_top_in_gigabytes(self):
        sizes = node_status.parse_top_memory(TOP_MEMORY)
        self.assertAlmostEqual(sizes[101], 3.96, places=2)
        self.assertAlmostEqual(sizes[102], 3.2, places=2)
        self.assertLess(sizes[104], 0.001)
        self.assertNotIn("Processes:", sizes)

    def test_services_are_named_and_use_the_footprint_not_the_tiny_resident_size(self):
        rows = {row["id"]: row for row in node_status.parse_processes(PS_LISTING, node_status.parse_top_memory(TOP_MEMORY))}
        self.assertEqual(rows["image"]["memGb"], 3.96)  # 13 MB resident, 4 GB of model in GPU memory
        self.assertEqual(rows["ollama"]["memGb"], 3.2)
        self.assertEqual(rows["docker"]["label"], "Máy ảo (Docker, Claude Code)")
        self.assertEqual(rows["ffmpeg"]["count"], 1)
        self.assertIn("media", rows)
        self.assertEqual(set(rows), {"image", "ollama", "docker", "ffmpeg", "media"})  # the Claude app in the listing is not one of the studio's programs
        ordered = [row["memGb"] for row in node_status.parse_processes(PS_LISTING, node_status.parse_top_memory(TOP_MEMORY))]
        self.assertEqual(ordered, sorted(ordered, reverse=True))

    def test_without_top_the_resident_size_is_used(self):
        rows = {row["id"]: row for row in node_status.parse_processes(PS_LISTING)}
        self.assertAlmostEqual(rows["ollama"]["memGb"], 0.19, places=2)

    def test_power_on_a_laptop_and_on_a_mini(self):
        self.assertEqual(node_status.parse_power(BATTERY_AC), ("ac", 87))
        self.assertEqual(node_status.parse_power(BATTERY_DISCHARGING), ("battery", 23))
        self.assertEqual(node_status.parse_power(MINI_AC), ("ac", None))
        self.assertEqual(node_status.parse_power(None), ("unknown", None))

    def test_thermal_throttling_is_any_limit_below_100(self):
        self.assertEqual(node_status.parse_thermal(THERMAL_NOMINAL), "nominal")
        self.assertEqual(node_status.parse_thermal(THERMAL_THROTTLED), "throttled")
        self.assertEqual(node_status.parse_thermal(None), "unknown")

    def test_resources_never_raise_when_commands_are_missing(self):
        with patch.object(node_status, "_run", return_value=None), patch.object(node_status.platform, "system", return_value="Darwin"):
            node_status._RESOURCES.update(at=0.0, value=None)
            value = node_status.read_resources(max_age_s=0)
        self.assertEqual(value["memPressure"], "unknown")
        self.assertEqual(value["power"], "unknown")
        self.assertEqual(value["thermal"], "unknown")
        self.assertIsNone(value["batteryPercent"])


class TokenTests(unittest.TestCase):
    def test_no_token_means_open(self):
        self.assertTrue(node_status.token_ok(None, ""))

    def test_bearer_must_match(self):
        self.assertTrue(node_status.token_ok("Bearer s3cret", "s3cret"))
        self.assertFalse(node_status.token_ok("Bearer other", "s3cret"))
        self.assertFalse(node_status.token_ok("s3cret", "s3cret"))
        self.assertFalse(node_status.token_ok(None, "s3cret"))

    def test_open_bind_without_token_refuses_to_start(self):
        with self.assertRaises(SystemExit):
            node_status.require_token_for_host("100.101.102.103", "")
        node_status.require_token_for_host("127.0.0.1", "")
        node_status.require_token_for_host("::1", "")
        node_status.require_token_for_host("100.101.102.103", "s3cret")
        node_status.require_token_for_host("100.101.102.103", "", allow_open=True)


class MetricsTests(unittest.TestCase):
    def test_only_successful_requests_move_the_average(self):
        metrics = node_status.Metrics()
        started = metrics.begin("image")
        self.assertEqual(metrics.active(), {"image": 1})
        time.sleep(0.02)
        metrics.end("image", started, ok=True)
        first = metrics.perf()["image"]
        self.assertGreaterEqual(first, 15)
        failed = metrics.begin("image")
        metrics.end("image", failed, ok=False)
        self.assertEqual(metrics.perf()["image"], first)
        self.assertEqual(metrics.active(), {})


class PauseTests(unittest.TestCase):
    def test_pause_file_stops_the_node_taking_work(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "paused"
            self.assertFalse(node_status.paused(marker))
            marker.write_text("")
            self.assertTrue(node_status.paused(marker))


class FingerprintTests(unittest.TestCase):
    def test_settings_and_code_decide_the_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "a.py"
            source.write_text("x = 1")
            base = node_status.fingerprint({"IMAGE_STEPS": 4}, [source])
            self.assertEqual(base, node_status.fingerprint({"IMAGE_STEPS": 4}, [source]))
            self.assertNotEqual(base, node_status.fingerprint({"IMAGE_STEPS": 6}, [source]))
            source.write_text("x = 2")
            self.assertNotEqual(base, node_status.fingerprint({"IMAGE_STEPS": 4}, [source]))


class ImageServerInfoTests(unittest.TestCase):
    """image_server_info reads the MLX server's /health: ready, still loading (503) or not running."""

    def serve(self, status, body):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def test_ready_loading_and_down(self):
        media = load_media_server()
        config = {"preset": "balanced", "steps": 4}
        with patch.object(media, "IMAGE_SERVER_URL", self.serve(200, {"ok": True, "config": config})):
            self.assertEqual(media.image_server_info(), ("ready", config))
        with patch.object(media, "IMAGE_SERVER_URL", self.serve(503, {"ok": False, "config": config})):
            self.assertEqual(media.image_server_info(), ("loading", config))
        with patch.object(media, "IMAGE_SERVER_URL", "http://127.0.0.1:9"):
            self.assertEqual(media.image_server_info(), ("down", {}))

    def test_a_server_from_before_the_config_field_reports_an_empty_one(self):
        media = load_media_server()
        with patch.object(media, "IMAGE_SERVER_URL", self.serve(200, {"ok": True})):
            self.assertEqual(media.image_server_info(), ("ready", {}))

    def test_missing_face_model_changes_the_fingerprint(self):
        media = load_media_server()
        patches = [
            patch.object(media, "image_server_info", return_value=("ready", {})),
            patch.object(media, "comfyui_state", return_value=("offline", "no")),
            patch.object(media, "tts_engines_up", return_value=["vieneu"]),
            patch.object(media, "find_binary", return_value="/usr/bin/ffmpeg"),
            patch.object(media, "ltx_state", return_value=("offline", "no")),
            patch.object(media, "service_up", return_value=True),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        with patch.object(media, "face_detail_state", return_value=(True, "ok")):
            with_faces = media.node_status_payload(max_age_s=0)["fingerprint"]
        with patch.object(media, "face_detail_state", return_value=(False, "Thiếu mô hình dò mặt")):
            without = media.node_status_payload(max_age_s=0)["fingerprint"]
        self.assertNotEqual(with_faces, without)


class BridgeEndpointTests(unittest.TestCase):
    """The real HTTP handler, with every downstream service mocked: auth and the /node-status contract."""

    @classmethod
    def setUpClass(cls):
        cls.media = load_media_server()
        cls.media.NODE_TOKEN = "s3cret"
        cls.patches = [
            patch.object(cls.media, "image_server_info", return_value=("ready", {"steps": 4, "preset": "balanced"})),
            patch.object(cls.media, "comfyui_state", return_value=("offline", "no")),
            patch.object(cls.media, "tts_engines_up", return_value=["vieneu", "piper"]),
            patch.object(cls.media, "find_binary", return_value="/usr/bin/ffmpeg"),
            patch.object(cls.media, "ltx_state", return_value=("offline", "no")),
            patch.object(cls.media, "service_up", return_value=True),
        ]
        for item in cls.patches:
            item.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), cls.media.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        for item in cls.patches:
            item.stop()

    def get(self, path, token=None):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode())

    def test_node_status_needs_the_token(self):
        self.assertEqual(self.get("/node-status")[0], 401)
        self.assertEqual(self.get("/node-status", "wrong")[0], 401)
        status, body = self.get("/node-status", "s3cret")
        self.assertEqual(status, 200)
        self.assertTrue(body["accepting"])
        self.assertTrue(body["capabilities"]["image"])
        self.assertTrue(body["capabilities"]["tts"])
        self.assertEqual(body["tts"]["defaultEngine"], "vieneu")
        self.assertEqual(body["image"]["state"], "ready")
        self.assertRegex(body["fingerprint"], r"^[0-9a-f]{12}$")
        # the values behind the fingerprint travel with it, so the main machine can say which one differs
        self.assertIn("IMAGE_STEPS", body["settings"])
        self.assertIn("VIENEU_STEPS", body["settings"])
        self.assertIn("memPressure", body["resources"])

    def test_health_stays_open_for_liveness_probes(self):
        self.assertEqual(self.get("/health")[0], 200)

    def test_models_and_posts_are_protected(self):
        self.assertEqual(self.get("/models")[0], 401)
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/image", data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(caught.exception.code, 401)


if __name__ == "__main__":
    unittest.main()
