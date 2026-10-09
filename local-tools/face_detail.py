#!/usr/bin/env python3
"""Redraw the faces of a generated picture at a larger size, then paste them back (an "ADetailer" pass).

SDXL-Turbo draws a face that covers ~100 px of a 576x1024 picture with a smeared eye or bent glasses. Each face found
by YuNet is cropped with its head, scaled to 512 px, redrawn by the image server (image-to-image, so pose, hair,
glasses and colours stay) and blended back under a feathered oval.

usage: face_detail.py IN.png OUT.png --style "style words" [--seed N]
Prints a JSON line {"faces": n}. Writes OUT.png only when at least one face was redrawn.
Runs with ~/Developer/local-ai/wb-venv/bin/python (OpenCV with FaceDetectorYN, numpy, Pillow).
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

MODEL = Path(os.getenv("FACE_MODEL", str(Path.home() / "Developer/local-ai/models/face/face_detection_yunet_2023mar.onnx")))
IMAGE_SERVER_URL = os.getenv("IMAGE_SERVER_URL", "http://127.0.0.1:5002")
# Below 0.75 YuNet also "found" faces in a bento box and a plate of chopsticks; a redraw there would paint a face on food.
MIN_SCORE = float(os.getenv("FACE_MIN_SCORE", "0.75"))
# 0.35 left the smeared eye half fixed; 0.5 redrew clean symmetric eyes and kept glasses, hair and skin colour.
STRENGTH = float(os.getenv("FACE_STRENGTH", "0.42"))
MAX_FACES = 4
CROP = 512


def detect(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    h, w = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(str(MODEL), "", (w, h), MIN_SCORE, 0.3, 5000)
    _, faces = detector.detect(image)
    if faces is None:
        return []
    boxes = [(int(f[0]), int(f[1]), int(f[2]), int(f[3])) for f in faces]
    # Largest first: the main character gets redrawn when there are more faces than MAX_FACES.
    return sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)[:MAX_FACES]


def head_square(box, w, h):
    """A square around the face with room for hair and chin, kept inside the picture."""
    x, y, bw, bh = box
    side = int(max(bw, bh) * 2.2)
    side = min(side, w, h)
    cx, cy = x + bw / 2, y + bh / 2 - bh * 0.1
    x0 = int(min(max(0, cx - side / 2), w - side))
    y0 = int(min(max(0, cy - side / 2), h - side))
    return x0, y0, side


def redraw(crop: Image.Image, prompt: str, seed: int) -> Image.Image:
    buffer = io.BytesIO()
    crop.save(buffer, format="PNG")
    body = {
        "prompt": prompt, "seed": seed, "steps": 4, "width": CROP, "height": CROP, "negativePrompt": "",
        "referenceImage": base64.b64encode(buffer.getvalue()).decode(), "referenceStrength": STRENGTH,
    }
    request = urllib.request.Request(f"{IMAGE_SERVER_URL}/generate", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return Image.open(io.BytesIO(response.read())).convert("RGB")


def oval_mask(side: int, box, x0: int, y0: int) -> np.ndarray:
    x, y, bw, bh = box
    mask = np.zeros((side, side), np.float32)
    # The face only: a wider oval also replaced the wall around the head, which came back lighter as a halo.
    centre = (int(x + bw / 2 - x0), int(y + bh / 2 - y0))
    axes = (max(4, int(bw * 0.62)), max(4, int(bh * 0.72)))
    cv2.ellipse(mask, centre, axes, 0, 0, 360, 1.0, -1)
    blur = max(3, (side // 12) | 1)
    return cv2.GaussianBlur(mask, (blur, blur), 0)[:, :, None]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--style", default="")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--who", default="a person", help='who the faces belong to, e.g. "a Vietnamese person"')
    args = parser.parse_args()
    if not MODEL.exists():
        print(json.dumps({"faces": 0, "skipped": "no face model"}))
        return 0
    picture = np.array(Image.open(args.input).convert("RGB"))
    h, w = picture.shape[:2]
    boxes = detect(cv2.cvtColor(picture, cv2.COLOR_RGB2BGR))
    # No expression words: "natural expression" turned smiles neutral. Naming who it is keeps Asian features Asian.
    prompt = ", ".join(part for part in (args.style, f"close-up portrait of {args.who}, detailed face, clear symmetrical eyes") if part)
    result = picture.astype(np.float32)
    done = 0
    for index, box in enumerate(boxes):
        x0, y0, side = head_square(box, w, h)
        # Big faces are already drawn in detail, and tiny ones are specks; neither gains from a redraw.
        if side > CROP or box[2] < 20:
            continue
        original = picture[y0:y0 + side, x0:x0 + side]
        redrawn = redraw(Image.fromarray(original).resize((CROP, CROP), Image.Resampling.LANCZOS), prompt, args.seed + index)
        redrawn = np.array(redrawn.resize((side, side), Image.Resampling.LANCZOS)).astype(np.float32)
        mask = oval_mask(side, box, x0, y0)
        # Keep the face's overall tone: image-to-image drifts lighter, which showed as a pale patch on the skin.
        inside = mask[:, :, 0] > 0.5
        if inside.any():
            redrawn += original[inside].mean(axis=0) - redrawn[inside].mean(axis=0)
        region = result[y0:y0 + side, x0:x0 + side]
        result[y0:y0 + side, x0:x0 + side] = region * (1 - mask) + np.clip(redrawn, 0, 255) * mask
        done += 1
    if done:
        Image.fromarray(np.clip(result, 0, 255).astype(np.uint8)).save(args.output)
    print(json.dumps({"faces": done}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
