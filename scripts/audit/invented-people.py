#!/usr/bin/env python3
"""Counts scene picture prompts that put a relative into the picture when the narration never names one.

Usage: invented-people.py <outDir> [B01 ...]   (reads Bxx.scenes.json written by benchmark-direct.smoke.ts)
A proxy for "the visual follows the narration": a first-person script about arguments must not be drawn as a mother, a child
and a father in every scene.
"""
import json
import re
import sys
from pathlib import Path

IN_PROMPT = re.compile(r"\b(son|daughter|child|children|kid|boy|girl|baby|toddler|mother|father|wife|husband|parents?|grand(?:mother|father|ma|pa)|family|couple|brother|sister)\b", re.I)
IN_NARRATION = re.compile(r"(?<![\wÀ-ỹ])(con|cháu|bé|mẹ|má|cha|bố|ba|vợ|chồng|bà|ông|anh|chị|em|gia đình|vợ chồng|cặp|trẻ)(?![\wÀ-ỹ])", re.I)

out = Path(sys.argv[1])
cases = sys.argv[2:] or sorted(p.name.split(".")[0] for p in out.glob("B*.scenes.json"))
total_scenes = total_invented = 0
for case in cases:
    scenes = json.loads((out / f"{case}.scenes.json").read_text())
    invented = [s["order"] for s in scenes if IN_PROMPT.search(s["imagePrompt"]) and not IN_NARRATION.search(s["narration"])]
    total_scenes += len(scenes)
    total_invented += len(invented)
    print(f"{case}: {len(invented)}/{len(scenes)} scenes show a relative the narration does not name {invented if invented else ''}")
print(f"TOTAL: {total_invented}/{total_scenes}")
