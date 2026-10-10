"""slim_model_cache: fp32 weights become fp16 exactly as astype(float16) does, and a failed check keeps the original.

Run: ~/Developer/local-ai/wb-venv/bin/python -m unittest discover -s local-tools/tests
"""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
import slim_model_cache as slim  # noqa: E402

np.seterr(over="ignore")  # the edge-case tensor holds values beyond fp16 range on purpose


def write_safetensors(path, tensors, metadata=None):
    header, blobs, offset = {}, [], 0
    for key, array in tensors.items():
        raw = array.tobytes()
        code = {"float32": "F32", "float16": "F16", "int64": "I64"}[str(array.dtype)]
        header[key] = {"dtype": code, "shape": list(array.shape), "data_offsets": [offset, offset + len(raw)]}
        blobs.append(raw)
        offset += len(raw)
    if metadata:
        header["__metadata__"] = metadata
    raw_header = json.dumps(header).encode()
    raw_header += b" " * (-len(raw_header) % 8)
    Path(path).write_bytes(struct.pack("<Q", len(raw_header)) + raw_header + b"".join(blobs))


def read_safetensors(path):
    header, base = slim.read_header(path)
    header.pop("__metadata__", None)
    data = Path(path).read_bytes()
    dtypes = {"F32": np.float32, "F16": np.float16, "I64": np.int64}
    return {k: np.frombuffer(data[base + v["data_offsets"][0]: base + v["data_offsets"][1]], dtype=dtypes[v["dtype"]]).reshape(v["shape"]) for k, v in header.items()}


class SlimFile(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        rng = np.random.default_rng(7)
        self.tensors = {
            "conv.weight": rng.standard_normal((4, 3, 3, 3)).astype(np.float32),
            "edge.cases": np.array([0.0, -0.0, 1e-8, 6.1e-5, 65504.0, 70000.0, -1e9, 1.0001], dtype=np.float32),
            "position_ids": np.arange(77, dtype=np.int64).reshape(1, 77),
        }
        self.path = self.tmp / "model.safetensors"
        write_safetensors(self.path, self.tensors, {"format": "pt"})

    def test_converts_to_exactly_astype_float16_and_keeps_other_dtypes(self):
        before = self.path.stat().st_size
        saved = slim.slim_file(self.path)
        out = read_safetensors(self.path)
        self.assertGreater(saved, 0)
        self.assertEqual(self.path.stat().st_size, before - saved)
        self.assertEqual(out["conv.weight"].dtype, np.float16)
        for key in ("conv.weight", "edge.cases"):
            self.assertTrue(np.array_equal(out[key].view(np.uint16), self.tensors[key].astype(np.float16).view(np.uint16)), key)
        self.assertEqual(out["position_ids"].dtype, np.int64)
        self.assertTrue(np.array_equal(out["position_ids"], self.tensors["position_ids"]))
        self.assertEqual(slim.read_header(self.path)[0]["__metadata__"], {"format": "pt"})
        self.assertEqual([p.name for p in self.tmp.iterdir()], ["model.safetensors"])

    def test_is_idempotent_on_a_file_that_is_already_fp16(self):
        slim.slim_file(self.path)
        once = self.path.read_bytes()
        self.assertEqual(slim.slim_file(self.path), 0)
        self.assertEqual(self.path.read_bytes(), once)

    def test_dry_run_changes_nothing(self):
        once = self.path.read_bytes()
        self.assertGreater(slim.slim_file(self.path, dry_run=True), 0)
        self.assertEqual(self.path.read_bytes(), once)

    def test_a_failed_check_keeps_the_original_and_leaves_no_temp_file(self):
        once = self.path.read_bytes()
        real = slim.verify
        slim.verify = lambda *args: (_ for _ in ()).throw(RuntimeError("values differ"))
        try:
            with self.assertRaises(RuntimeError):
                slim.slim_file(self.path)
        finally:
            slim.verify = real
        self.assertEqual(self.path.read_bytes(), once)
        self.assertEqual([p.name for p in self.tmp.iterdir()], ["model.safetensors"])

    def test_verify_catches_a_corrupted_value(self):
        header, base = slim.read_header(self.path)
        header.pop("__metadata__")
        items = sorted(header.items(), key=lambda kv: kv[1]["data_offsets"][0])
        stage = self.tmp / "stage.safetensors"
        stage.write_bytes(self.path.read_bytes())  # still fp32: dtype check must refuse it
        with self.assertRaises(RuntimeError):
            slim.verify(self.path, stage, items, base)


class SnapshotWalk(unittest.TestCase):
    def test_follows_snapshot_links_to_each_blob_once_and_skips_missing_repos(self):
        tmp = Path(tempfile.mkdtemp())
        repo = tmp / "models--stabilityai--sdxl-turbo"
        (repo / "blobs").mkdir(parents=True)
        (repo / "snapshots/abc/unet").mkdir(parents=True)
        (repo / "snapshots/abc/vae").mkdir(parents=True)
        write_safetensors(repo / "blobs/hash1", {"w": np.ones((2, 2), dtype=np.float32)})
        (repo / "snapshots/abc/unet/model.safetensors").symlink_to("../../../blobs/hash1")
        (repo / "snapshots/abc/vae/model.safetensors").symlink_to("../../../blobs/hash1")
        self.assertEqual(slim.snapshot_blobs(repo), [(repo / "blobs/hash1").resolve()])
        self.assertEqual(slim.main(["--cache", str(tmp), "--dry-run"]), 0)
        self.assertEqual(slim.main(["--cache", str(tmp / "nothing-here")]), 0)


if __name__ == "__main__":
    unittest.main()
