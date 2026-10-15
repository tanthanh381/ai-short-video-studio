"""Checks for the idle-sleep of the model servers (no launchctl is run: a fake stands in for it).

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
"""

import unittest
import unittest.mock

import idle_sleep


class FakeLaunchd:
    def __init__(self, installed=("img", "tts"), loaded=("img", "tts")):
        self.is_installed = set(installed)
        self.is_loaded = set(loaded)
        self.calls = []

    def installed(self, label):
        return label in self.is_installed

    def loaded(self, label):
        return label in self.is_loaded

    def unload(self, label):
        self.calls.append(("unload", label))
        self.is_loaded.discard(label)

    def load(self, label):
        self.calls.append(("load", label))
        self.is_loaded.add(label)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def make(idle_s=600, up=lambda: True, **fake):
    clock = Clock()
    launchd = FakeLaunchd(**fake)
    services = [idle_sleep.Service("image", "img", up), idle_sleep.Service("tts", "tts", lambda: True)]
    sleeper = idle_sleep.Sleeper(services, idle_s, launchd, clock, sleep=lambda s: clock.advance(s))
    return sleeper, launchd, clock


class ConfigTests(unittest.TestCase):
    def test_minutes_from_the_environment(self):
        self.assertEqual(idle_sleep.configured_idle_seconds({"STUDIO_IDLE_SLEEP_MIN": "5"}), 300)
        self.assertEqual(idle_sleep.configured_idle_seconds({}), 5 * 60)
        self.assertEqual(idle_sleep.configured_idle_seconds({"STUDIO_IDLE_SLEEP_MIN": "abc"}), 5 * 60)
        self.assertEqual(idle_sleep.configured_idle_seconds({"STUDIO_IDLE_SLEEP_MIN": "0"}), 0)
        self.assertEqual(idle_sleep.configured_idle_seconds({"STUDIO_IDLE_SLEEP_MIN": "-3"}), 0)


class SleepTests(unittest.TestCase):
    def test_only_services_idle_past_the_limit_sleep(self):
        sleeper, launchd, clock = make()
        clock.advance(500)
        self.assertEqual(sleeper.sleep_idle(), [])
        sleeper.touch("tts")  # used at 500 s
        clock.advance(200)  # image idle 700 s, tts 200 s
        self.assertEqual(sleeper.sleep_idle(), ["image"])
        self.assertEqual(launchd.calls, [("unload", "img")])
        self.assertTrue(sleeper.asleep("image"))
        self.assertFalse(sleeper.asleep("tts"))
        self.assertEqual(sleeper.sleep_idle(), [])  # already asleep: nothing to do twice

    def test_a_request_in_flight_is_never_taken_for_idleness(self):
        sleeper, launchd, clock = make()
        sleeper.touch("image", +1)
        clock.advance(5000)
        self.assertEqual(sleeper.sleep_idle(), ["tts"])
        sleeper.touch("image", -1)
        clock.advance(100)
        self.assertEqual(sleeper.sleep_idle(), [])  # used 100 s ago, when the request ended
        clock.advance(600)
        self.assertEqual(sleeper.sleep_idle(), ["image"])

    def test_a_rarely_used_heavy_server_sleeps_sooner_but_never_later(self):
        clock = Clock()
        launchd = FakeLaunchd()
        services = [idle_sleep.Service("image", "img", lambda: True), idle_sleep.Service("tts", "tts", lambda: True, idle_cap_s=180)]
        sleeper = idle_sleep.Sleeper(services, 600, launchd, clock)
        clock.advance(200)
        self.assertEqual(sleeper.sleep_idle(), ["tts"])
        short = idle_sleep.Sleeper([idle_sleep.Service("tts", "tts", lambda: True, idle_cap_s=900)], 60, FakeLaunchd(), clock)
        clock.advance(100)
        self.assertEqual(short.sleep_idle(), ["tts"])  # the global limit, when shorter, wins

    def test_keep_and_disabled_and_missing_plist(self):
        sleeper, launchd, clock = make()
        clock.advance(5000)
        self.assertEqual(sleeper.sleep_idle(keep=("image",)), ["tts"])
        off, _, clock2 = make(idle_s=0)
        clock2.advance(99999)
        self.assertEqual(off.sleep_idle(), [])
        bare, launchd2, clock3 = make(installed=())  # a Mac that has no launchd jobs for them (the Air before installing)
        clock3.advance(5000)
        self.assertEqual(bare.sleep_idle(), [])
        self.assertFalse(bare.asleep("image"))
        self.assertEqual(launchd2.calls, [])


class WakeTests(unittest.TestCase):
    def test_wakes_a_sleeping_service_and_waits_for_its_health(self):
        state = {"ready_after": 3}

        def up():
            state["ready_after"] -= 1
            return state["ready_after"] < 0

        sleeper, launchd, clock = make(up=up, loaded=("tts",))
        self.assertTrue(sleeper.asleep("image"))
        self.assertTrue(sleeper.ensure_awake("image"))
        self.assertEqual(launchd.calls, [("load", "img")])
        self.assertFalse(sleeper.asleep("image"))
        self.assertEqual(sleeper.last_used["image"], clock.now)

    def test_a_service_that_is_up_is_not_touched(self):
        sleeper, launchd, _ = make()
        self.assertFalse(sleeper.ensure_awake("image"))
        self.assertEqual(launchd.calls, [])
        self.assertFalse(sleeper.ensure_awake("unknown"))

    def test_gives_up_when_it_never_answers(self):
        sleeper, launchd, _ = make(up=lambda: False, loaded=())
        with self.assertRaisesRegex(RuntimeError, "thức dậy quá lâu"):
            sleeper.ensure_awake("image")

    def test_snapshot_reports_sleep_and_idle_time(self):
        sleeper, _, clock = make(loaded=("tts",))
        clock.advance(42)
        self.assertEqual(sleeper.snapshot()["image"], {"asleep": True, "idleSeconds": 42})
        self.assertEqual(sleeper.snapshot()["tts"], {"asleep": False, "idleSeconds": 42})


if __name__ == "__main__":
    unittest.main()


class ProcessControlTests(unittest.TestCase):
    """A server started by a script, not launchd (the Air): a real throw-away HTTP server is stopped and started again."""

    def test_sleeps_and_wakes_a_script_started_server(self):
        import socket
        import sys
        import tempfile
        import time
        from pathlib import Path
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory:
            control = idle_sleep.ProcessControl("demo", port, [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                                                Path(directory) / "asleep.json", cwd=directory)
            service = idle_sleep.Service("demo", "no.such.label", lambda: idle_sleep.port_open(port), wake_timeout_s=20, process=control)
            clock = Clock()
            sleeper = idle_sleep.Sleeper([service], 60, FakeLaunchd(installed=(), loaded=()), clock, sleep=lambda s: (time.sleep(0.2), clock.advance(0.2)))
            try:
                self.assertFalse(sleeper.asleep("demo"))  # never started and never put to sleep: not "asleep", just down
                control.load()
                deadline = time.time() + 15
                while not idle_sleep.port_open(port) and time.time() < deadline:
                    time.sleep(0.2)
                self.assertTrue(idle_sleep.port_open(port))
                clock.advance(61)
                self.assertEqual(sleeper.sleep_idle(), ["demo"])
                self.assertFalse(idle_sleep.port_open(port))
                self.assertTrue(sleeper.asleep("demo"))
                self.assertTrue(sleeper.ensure_awake("demo"))
                self.assertTrue(idle_sleep.port_open(port))
                self.assertFalse(sleeper.asleep("demo"))
            finally:
                pid = idle_sleep.listener_pid(port)
                if pid:
                    import os
                    import signal
                    os.kill(pid, signal.SIGTERM)

    def test_a_crashed_server_is_not_taken_for_a_sleeping_one(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            control = idle_sleep.ProcessControl("demo", 1, ["/bin/sh"], Path(directory) / "asleep.json")
            self.assertTrue(control.loaded())  # port closed but nobody asked it to sleep: the supervisor's business


class BridgeWiringTests(unittest.TestCase):
    """Which sleeping services each bridge request needs, and that a sleeping Mac still looks capable and identical."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location("studio_media_idle", Path(__file__).with_name("media_server.py"))
        cls.media = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.media)

    def test_each_route_names_the_services_it_needs(self):
        m = self.media
        self.assertEqual(m.services_for("/image", b'{"prompt":"x"}'), ["image"])
        self.assertEqual(m.services_for("/image", ('{"model":"%s"}' % m.COMFYUI_IMAGE_MODEL).encode()), ["image", "comfyui"])
        self.assertEqual(m.services_for("/image", b"not json"), ["image"])
        self.assertEqual(m.services_for("/tts-aligned", b"{}"), ["vieneu"])
        self.assertEqual(m.services_for("/transcribe?model=x", b""), ["whisper"])
        self.assertEqual(m.services_for("/video", b"{}"), ["ltx"])
        self.assertEqual(m.services_for("/sync-now", b""), [])

    def test_image_settings_are_remembered_while_the_server_sleeps(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory, unittest.mock.patch.object(self.media, "SERVICE_LOG_DIR", Path(directory)):
            seen = {"steps": 4, "preset": "fast"}
            self.assertEqual(self.media.remembered_image_config(seen), seen)
            self.assertEqual(self.media.remembered_image_config({}), seen)  # asleep: the last ones stand in
        with tempfile.TemporaryDirectory() as directory, unittest.mock.patch.object(self.media, "SERVICE_LOG_DIR", Path(directory)):
            self.assertEqual(self.media.remembered_image_config({}), {})  # never seen: nothing invented

    def test_a_sleeping_server_is_reported_as_available(self):
        m = self.media
        with unittest.mock.patch.object(m.SLEEPER, "asleep", lambda name: name in ("image", "vieneu", "whisper", "ltx")), \
             unittest.mock.patch.object(m, "image_server_info", lambda: ("down", {})), \
             unittest.mock.patch.object(m, "service_up", lambda *a, **k: False), \
             unittest.mock.patch.object(m, "comfyui_state", lambda: ("offline", "")), \
             unittest.mock.patch.object(m, "ltx_state", lambda: ("down", "")):
            m._NODE_STATUS_CACHE.update(at=0.0, value=None)
            status = m.node_status_payload(max_age_s=0)
            m._NODE_STATUS_CACHE.update(at=0.0, value=None)
        self.assertEqual(status["image"]["state"], "asleep")
        self.assertTrue(status["capabilities"]["image"] and status["capabilities"]["transcribe"] and status["capabilities"]["video"])
        self.assertIn("vieneu", status["tts"]["engines"])
