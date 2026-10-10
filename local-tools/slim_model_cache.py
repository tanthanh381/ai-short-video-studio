#!/usr/bin/env python3
"""Halve the SDXL-Turbo download (13.9 GB of fp32 weights -> 6.9 GB) without changing a single output pixel.

image_server.py loads SDXL-Turbo through MLX with float16=True, and the loader runs every tensor through astype(float16),
so the fp32 files in the Hugging Face cache are only ever used as fp16. This rewrites them as fp16 in place, one tensor in
memory at a time, and proves each new file before it replaces the old one (a failed check leaves the original untouched).
Run it once after the first image generation downloaded the model; it is safe to repeat (fp16 files are skipped).

    python local-tools/slim_model_cache.py            # convert
    python local-tools/slim_model_cache.py --dry-run  # only report what would be saved

Stop or unload the image server first (curl -X POST localhost:5002/unload); it reloads the slim files on the next picture.
"""
import argparse
import json
import math
import os
import struct
import sys
from pathlib import Path

import numpy as np

np.seterr(over="ignore")  # a value beyond fp16 range becomes inf, exactly as the MLX loader's astype(float16) does

LOCAL_AI_ROOT = Path(os.getenv("LOCAL_AI_ROOT", str(Path.home() / "Developer" / "local-ai")))
DEFAULT_CACHE = Path(os.getenv("HF_HOME", str(LOCAL_AI_ROOT / "models/image/hf-cache"))) / "hub"
# Repos whose loader casts to fp16 anyway. Never add a model that needs its fp32 weights.
SLIMMABLE = ["models--stabilityai--sdxl-turbo"]


def read_header(path):
    with open(path, "rb") as f:
        size = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(size))
    return header, 8 + size


def slim_file(blob, dry_run=False):
    """Rewrite one safetensors file with F32 tensors as F16. Returns the bytes saved (0 when nothing to do)."""
    blob = Path(blob)
    header, base = read_header(blob)
    meta = header.pop("__metadata__", None)
    items = sorted(header.items(), key=lambda kv: kv[1]["data_offsets"][0])
    if not any(info["dtype"] == "F32" for _, info in items):
        return 0
    new, offset = {}, 0
    for key, info in items:
        a, b = info["data_offsets"]
        size = (b - a) // 2 if info["dtype"] == "F32" else b - a
        new[key] = {"dtype": "F16" if info["dtype"] == "F32" else info["dtype"], "shape": info["shape"], "data_offsets": [offset, offset + size]}
        offset += size
    saved = blob.stat().st_size - (base + offset)  # the header is the same size to within a few bytes
    if dry_run:
        return max(saved, 0)
    if meta is not None:
        new["__metadata__"] = meta
    raw_header = json.dumps(new, separators=(",", ":")).encode()
    raw_header += b" " * (-len(raw_header) % 8)
    stage = blob.with_name(f"stage-{blob.name[:12]}.safetensors")
    source = np.memmap(blob, dtype=np.uint8, mode="r")
    try:
        with open(stage, "wb") as out:
            out.write(struct.pack("<Q", len(raw_header)) + raw_header)
            for key, info in items:
                a, b = info["data_offsets"]
                chunk = source[base + a: base + b]
                if info["dtype"] == "F32":
                    out.write(np.frombuffer(chunk, dtype=np.float32).astype(np.float16).tobytes())
                else:
                    out.write(bytes(chunk))
        verify(blob, stage, items, base)
    except BaseException:
        stage.unlink(missing_ok=True)
        raise
    finally:
        del source
    saved = blob.stat().st_size - stage.stat().st_size
    os.replace(stage, blob)
    return saved


def verify(blob, stage, items, base):
    """Read the staged file back with its own header and compare every tensor with the fp16 cast of the original."""
    header, new_base = read_header(stage)
    header.pop("__metadata__", None)
    if set(header) != {key for key, _ in items}:
        raise RuntimeError("tensor names differ")
    original = np.memmap(blob, dtype=np.uint8, mode="r")
    staged = np.memmap(stage, dtype=np.uint8, mode="r")
    end = 0
    for key, info in items:
        a, b = info["data_offsets"]
        got = header[key]
        c, d = got["data_offsets"]
        end = max(end, d)
        if got["shape"] != info["shape"]:
            raise RuntimeError(f"{key}: shape changed")
        want = original[base + a: base + b]
        have = staged[new_base + c: new_base + d]
        if info["dtype"] == "F32":
            if got["dtype"] != "F16" or d - c != math.prod(info["shape"]) * 2:
                raise RuntimeError(f"{key}: not stored as fp16")
            want = np.frombuffer(want, dtype=np.float32).astype(np.float16).view(np.uint8)
        elif got["dtype"] != info["dtype"]:
            raise RuntimeError(f"{key}: dtype changed")
        if not np.array_equal(np.asarray(want), np.asarray(have)):
            raise RuntimeError(f"{key}: values differ")
    if new_base + end != stage.stat().st_size:
        raise RuntimeError("file size does not match its header")


def snapshot_blobs(repo_dir):
    """The real files behind the model's snapshot symlinks (each blob once)."""
    seen = {}
    for link in sorted(Path(repo_dir, "snapshots").rglob("*.safetensors")):
        seen.setdefault(link.resolve(), link)
    return list(seen)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="Hugging Face hub directory")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    total = 0
    for repo in SLIMMABLE:
        repo_dir = args.cache / repo
        if not repo_dir.is_dir():
            print(f"{repo}: not downloaded, nothing to do")
            continue
        for blob in snapshot_blobs(repo_dir):
            saved = slim_file(blob, args.dry_run)
            total += saved
            print(f"{repo}: {blob.name[:12]} {'would save' if args.dry_run else 'saved'} {saved / 1e6:.0f} MB" if saved else f"{repo}: {blob.name[:12]} already fp16")
    print(f"{'Would save' if args.dry_run else 'Saved'} {total / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
