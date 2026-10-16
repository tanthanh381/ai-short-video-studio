"""The guard that stops an LTX clip when the Mac starts paging hard while it animates (no LTX is run here)."""

import importlib.util
import threading
import unittest
from pathlib import Path


def load():
    spec = importlib.util.spec_from_file_location("studio_media_watchdog", Path(__file__).with_name("media_server.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeStop:
    """stop.wait() advances a fake clock instead of sleeping."""

    def __init__(self, clock, ticks=50):
        self.clock, self.ticks, self.set_flag = clock, ticks, False

    def wait(self, seconds):
        self.ticks -= 1
        self.clock["t"] += seconds
        return self.set_flag or self.ticks <= 0


class WatchPaging(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media = load()

    def run_with(self, rates):
        clock = {"t": 0.0}
        fired = []
        samples = iter(rates)
        result = self.media.watch_paging(FakeStop(clock, ticks=len(rates)), read=lambda: {"swapOutMBps": next(samples, None)},
                                         on_thrash=fired.append, interval_s=5, limit_mbps=80, sustain_s=30, clock=lambda: clock["t"])
        return result, fired

    def test_sustained_heavy_paging_stops_the_clip_once(self):
        result, fired = self.run_with([340] * 10)
        self.assertTrue(result)
        self.assertEqual(fired, [340])

    def test_a_short_burst_or_light_paging_is_tolerated(self):
        self.assertEqual(self.run_with([200, 200, 10, 200, 200, 10, 200, 200, 10])[1], [])  # never 30 s in a row
        self.assertEqual(self.run_with([40] * 12)[1], [])  # below the limit
        self.assertEqual(self.run_with([None] * 12)[1], [])  # a bridge that cannot measure paging never stops a clip

    def test_returns_when_the_clip_finishes(self):
        stop = threading.Event()
        stop.set()
        self.assertFalse(self.media.watch_paging(stop, read=lambda: {"swapOutMBps": 500}, on_thrash=lambda _: None, interval_s=0.01))

    def test_stopping_ltx_never_raises(self):
        original = self.media.listener_pid
        try:
            self.media.listener_pid = lambda port: None
            self.media.stop_ltx_runtime("test")  # nothing listening: nothing to do
            self.media.listener_pid = lambda port: (_ for _ in ()).throw(OSError("lsof missing"))
            self.media.stop_ltx_runtime("test")
        finally:
            self.media.listener_pid = original


class ProcessNames(unittest.TestCase):
    def test_the_dashboard_names_the_ltx_process(self):
        import node_status
        ids = [entry[0] for entry in node_status.SERVICE_PATTERNS if entry[2].search("python /x/local-tools/ltx_server.py")]
        self.assertEqual(ids, ["ltx"])


if __name__ == "__main__":
    unittest.main()
