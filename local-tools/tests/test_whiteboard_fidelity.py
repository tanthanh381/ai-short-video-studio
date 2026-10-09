"""The hand-drawn video must end on the exact source picture.

Run: ~/Developer/local-ai/wb-venv/bin/python -m unittest discover -s local-tools/tests
"""
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "whiteboard"))
import render_stream_whiteboard as rw  # noqa: E402
import stream_render as sr  # noqa: E402


def doodle() -> np.ndarray:
    """White backdrop, black outlines and flat colours, plus a light skin tone close to the backdrop colour.

    That light patch is what the old background matching repainted paper-coloured (holes in faces)."""
    image = np.full((400, 240, 3), 250, np.uint8)
    cv2.circle(image, (120, 120), 60, (215, 225, 240), -1)   # light face, within the old matching threshold
    cv2.circle(image, (120, 120), 60, (20, 20, 20), 4)
    cv2.rectangle(image, (60, 220), (180, 360), (60, 90, 200), -1)
    cv2.rectangle(image, (60, 220), (180, 360), (20, 20, 20), 4)
    return image


def annotation(width: int, height: int, ms: int) -> dict:
    return {"sceneId": "t", "canvas": {"width": width, "height": height}, "sceneDurationMs": ms, "elements": [{
        "id": "a", "label": "a", "sequence": 1, "narrativeRole": "scene", "subtitle": "", "type": "scene",
        "region": {"x": 0, "y": 0, "width": width, "height": height},
        "reveal": {"direction": "top_to_bottom", "startMs": 0, "durationMs": int(ms * 0.7), "maskPaddingPx": 0,
                   "protectedRegions": []},
        "handPath": {"start": [width // 2, 0], "end": [width // 2, height], "easing": "easeInOut"}}]}


def frames(path: Path) -> list[np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    out = []
    while True:
        ok, frame = capture.read()
        if not ok:
            return out
        out.append(frame)


class WhiteboardFidelity(unittest.TestCase):
    def render(self, image: np.ndarray, ms: int = 1500) -> tuple[rw.RegionStreamRenderer, list[np.ndarray]]:
        renderer = rw.RegionStreamRenderer(image, annotation(image.shape[1], image.shape[0], ms),
                                           sr.Config(cap_long_edge=max(image.shape[:2]), fps=20), None, True)
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "raw.mp4"
            renderer.render_to(raw, ms)
            return renderer, frames(raw)

    def test_last_frame_is_the_source_picture(self):
        image = doodle()
        renderer, video = self.render(image)
        self.assertGreater(len(video), 10)
        source = cv2.resize(image, (renderer.out_w, renderer.out_h), interpolation=cv2.INTER_AREA)
        off = np.abs(video[-1].astype(int) - source.astype(int)).max(axis=2) > 40
        self.assertLess(off.mean(), 0.005, f"{off.mean():.1%} of the finished picture differs from the source")

    def test_drawing_never_changes_the_picture_it_reads(self):
        image = doodle()
        renderer, _ = self.render(image)
        np.testing.assert_array_equal(renderer.color_img, renderer.source_img)

    def test_paper_takes_a_light_backdrop_and_keeps_cream_otherwise(self):
        light, _ = self.render(doodle(), 600)
        self.assertEqual(tuple(int(v) for v in light.canvas_bgr), (250, 250, 250))
        dark_image = doodle()
        dark_image[:] = (40, 60, 30)
        dark, _ = self.render(dark_image, 600)
        self.assertEqual(tuple(int(v) for v in dark.canvas_bgr), tuple(int(v) for v in sr._hex_to_bgr("#F6F1E3")))


if __name__ == "__main__":
    unittest.main()
