"""Face redraw pass: geometry, when it runs, and that a failure keeps the picture.

Run: ~/Developer/local-ai/wb-venv/bin/python -m unittest discover -s local-tools/tests
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
import face_detail  # noqa: E402

spec = importlib.util.spec_from_file_location("media_server", TOOLS / "media_server.py")
media_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media_server)


class Geometry(unittest.TestCase):
    def test_head_square_is_square_and_inside_the_picture(self):
        for box in [(0, 0, 80, 100), (500, 950, 70, 70), (250, 100, 120, 160), (10, 500, 300, 300)]:
            x0, y0, side = face_detail.head_square(box, 576, 1024)
            self.assertGreaterEqual(x0, 0)
            self.assertGreaterEqual(y0, 0)
            self.assertLessEqual(x0 + side, 576)
            self.assertLessEqual(y0 + side, 1024)

    def test_oval_covers_the_face_and_fades_out_before_the_crop_edge(self):
        box = (200, 200, 80, 100)
        x0, y0, side = face_detail.head_square(box, 576, 1024)
        mask = face_detail.oval_mask(side, box, x0, y0)[:, :, 0]
        centre = (int(box[1] + box[3] / 2 - y0), int(box[0] + box[2] / 2 - x0))
        self.assertGreater(mask[centre], 0.95)
        self.assertLess(max(mask[0].max(), mask[-1].max(), mask[:, 0].max(), mask[:, -1].max()), 0.01)

    def test_large_face_crop_is_not_redrawn_at_the_picture_edge(self):
        self.assertFalse(face_detail.should_redraw((80, 120, 150, 260), 512, 896))
        self.assertTrue(face_detail.should_redraw((120, 180, 42, 48), 512, 896))


class WhenItRuns(unittest.TestCase):
    def test_face_detail_is_opt_in_to_preserve_a_good_generated_picture(self):
        original = media_server.FACE_DETAIL
        try:
            media_server.FACE_DETAIL = False
            picture = b"original generated picture"
            self.assertEqual(media_server.detail_faces(picture, "style", "a Vietnamese woman", 2401), picture)
        finally:
            media_server.FACE_DETAIL = original

    def test_people_prompts_qualify_and_objects_or_animals_do_not(self):
        people = ["Two elderly Vietnamese friends on a bench", "a Vietnamese mother with a black bun", "An old farmer waters a tree"]
        others = ["Close-up of chopsticks on a plate with fish", "A vibrant Japanese bento box", "a cat sleeping on a sofa"]
        for prompt in people:
            self.assertTrue(media_server.FACE_SUBJECT_RE.search(prompt), prompt)
        for prompt in others:
            self.assertFalse(media_server.FACE_SUBJECT_RE.search(prompt), prompt)

    def test_face_redraw_only_runs_for_explicit_portrait_requests(self):
        self.assertTrue(media_server.FACE_DETAIL_REQUEST_RE.search("close-up portrait of a Vietnamese woman"))
        self.assertTrue(media_server.FACE_DETAIL_REQUEST_RE.search("detailed face, symmetrical eyes"))
        self.assertFalse(media_server.FACE_DETAIL_REQUEST_RE.search("a Vietnamese man typing beside a laptop"))
        self.assertFalse(media_server.FACE_DETAIL_REQUEST_RE.search("hands checking a document at a desk"))

    def test_action_first_guard_prioritizes_objects_over_faces(self):
        self.assertTrue(media_server.ACTION_FIRST_RE.search("hands typing beside a laptop"))
        self.assertFalse(media_server.ACTION_FIRST_RE.search("close-up portrait of a Vietnamese woman"))

    def test_a_failing_redraw_keeps_the_picture_and_is_reported(self):
        original = (media_server.FACE_PYTHON, dict(media_server.FACE_STATS))
        try:
            media_server.FACE_PYTHON = "/usr/bin/false"
            picture = b"not really a png"
            if media_server.face_detail_state()[0]:
                self.assertEqual(media_server.detail_faces(picture, "style", "a Vietnamese man", 1), picture)
                self.assertIsNotNone(media_server.FACE_STATS["lastError"])
            media_server.FACE_PYTHON = "/nonexistent/python"
            self.assertFalse(media_server.face_detail_state()[0])
            self.assertEqual(media_server.detail_faces(picture, "style", "a Vietnamese man", 1), picture)
        finally:
            media_server.FACE_PYTHON = original[0]
            media_server.FACE_STATS.clear()
            media_server.FACE_STATS.update(original[1])

    def test_a_picture_without_faces_is_left_alone(self):
        if not face_detail.MODEL.exists():
            self.skipTest("face model not installed")
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "in.png", Path(tmp) / "out.png"
            Image.fromarray(np.full((256, 256, 3), 230, np.uint8)).save(source)
            done = subprocess.run([sys.executable, str(TOOLS / "face_detail.py"), str(source), str(target)],
                                  capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(done.stdout.strip().splitlines()[-1])["faces"], 0)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
