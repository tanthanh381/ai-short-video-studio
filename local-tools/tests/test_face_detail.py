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


class WhenItRuns(unittest.TestCase):
    def test_people_prompts_qualify_and_objects_or_animals_do_not(self):
        people = ["Two elderly Vietnamese friends on a bench", "a Vietnamese mother with a black bun", "An old farmer waters a tree"]
        others = ["Close-up of chopsticks on a plate with fish", "A vibrant Japanese bento box", "a cat sleeping on a sofa"]
        for prompt in people:
            self.assertTrue(media_server.FACE_SUBJECT_RE.search(prompt), prompt)
        for prompt in others:
            self.assertFalse(media_server.FACE_SUBJECT_RE.search(prompt), prompt)

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
