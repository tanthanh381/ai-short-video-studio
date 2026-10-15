#!/usr/bin/env python3
"""Technical quality gates for the benchmark videos (what a machine can measure; not taste).

Usage: evaluate-benchmark.py <outDir> [B01 B02 ...]
  <outDir> holds Bxx.mp4, Bxx.scenes.json and, per case, a folder Bxx/ with the scene pictures (written by
  apps/worker/src/benchmark-direct.smoke.ts). Needs ffmpeg/ffprobe; Pillow for the picture checks (skipped when missing).

Gates (from the audit brief): 9:16 H.264/AAC that opens; no clipping (true peak below -1 dBTP); no dead air (silence over 1.5 s);
no scene held over 9 s; no near-identical pictures repeated back to back.
Captions are only flagged for a human look ("captionEdge": bright outlined pixels at the frame's side edges). A pixel test cannot
tell a caption from a bright part of the picture, so it is not a pass/fail gate; libass wraps captions inside 76 px margins by design.
Scores for hook, story, visual relevance, voice and emotion are a human's judgement and are NOT produced here.
"""
import json
import re
import subprocess
import sys
from pathlib import Path


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt:format=duration,size,bit_rate",
               "-of", "json", str(path)])
    return json.loads(out.stdout or "{}")


def loudness(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "loudnorm=print_format=json", "-vn", "-f", "null", "-"]).stderr
    block = out[out.rfind("{"):out.rfind("}") + 1]
    try:
        data = json.loads(block)
        return float(data["input_i"]), float(data["input_tp"]), float(data["input_lra"])
    except (ValueError, KeyError):
        return None, None, None


def silences(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "silencedetect=n=-45dB:d=0.4", "-vn", "-f", "null", "-"]).stderr
    durations = [float(m) for m in re.findall(r"silence_duration: ([0-9.]+)", out)]
    return len(durations), max(durations, default=0.0)


def peak_db(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "astats=metadata=0:reset=0", "-vn", "-f", "null", "-"]).stderr
    values = [float(v) for v in re.findall(r"Peak level dB: (-?[0-9.]+|-inf)", out) if v != "-inf"]
    return max(values, default=None)


def average_hash(image):
    small = image.convert("L").resize((8, 8))
    pixels = list(small.getdata()) if not hasattr(small, 'get_flattened_data') else list(small.get_flattened_data())
    mean = sum(pixels) / len(pixels)
    return [1 if p > mean else 0 for p in pixels]


def picture_repetition(folder):
    try:
        from PIL import Image
    except ImportError:
        return None
    files = sorted(folder.glob("*.png"), key=lambda f: f.stat().st_mtime)  # pictures were drawn in scene order
    if len(files) < 2:
        return None
    hashes = [average_hash(Image.open(f)) for f in files]
    close = sum(1 for a, b in zip(hashes, hashes[1:]) if sum(x != y for x, y in zip(a, b)) <= 6)
    return {"pairsChecked": len(files) - 1, "nearIdenticalNeighbours": close}


def caption_edge_hits(path, duration):
    """Pale or green caption pixels within 18 px of the left/right edge of the caption band, sampled twice a second.
    A row that lights up in at least 80% of the samples is a fixed element (the progress bar), not a caption, and is ignored."""
    try:
        from PIL import Image
    except ImportError:
        return None
    per_row = {}
    samples = 0
    t = 0.5
    frame = Path("/tmp/_eval_frame.png")
    while t < duration - 0.3:
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-update", "1", str(frame)])
        if frame.exists():
            image = Image.open(frame).convert("RGB")
            w, h = image.size
            def dark_near(x, y):
                # caption letters carry a dark outline; a bright patch of the picture usually does not
                for dx in (-4, 4, -8, 8):
                    nx = min(max(x + dx, 0), w - 1)
                    r2, g2, b2 = image.getpixel((nx, y))
                    if r2 < 70 and g2 < 70 and b2 < 70:
                        return True
                return False

            for y in range(int(h * 0.715), int(h * 0.86), 4):
                count = 0
                for x in list(range(0, 18)) + list(range(w - 18, w)):
                    r, g, b = image.getpixel((x, y))
                    if ((r > 225 and g > 225 and b > 205) or (g > 220 and r > 170 and b < 130)) and dark_near(x, y):
                        count += 1
                if count:
                    per_row.setdefault(y, []).append(count)
            samples += 1
        t += 0.5
    edge = sum(sum(v) for v in per_row.values() if len(v) < 0.8 * samples)
    return {"samples": samples, "edgePixels": edge}


def evaluate(out, case):
    video = out / f"{case}.mp4"
    result = {"id": case, "exists": video.exists()}
    if not video.exists():
        return result
    info = probe(video)
    streams = {s["codec_type"]: s for s in info.get("streams", [])}
    v, a = streams.get("video", {}), streams.get("audio", {})
    duration = float(info["format"]["duration"])
    result.update(
        width=v.get("width"), height=v.get("height"), video=v.get("codec_name"), pix=v.get("pix_fmt"), audio=a.get("codec_name"),
        duration=round(duration, 1), sizeMB=round(int(info["format"]["size"]) / 1e6, 2),
    )
    lufs, tp, lra = loudness(video)
    count, longest = silences(video)
    result.update(lufs=lufs, truePeak=tp, lra=lra, peakDb=peak_db(video), silences=count, longestSilence=round(longest, 2))
    scenes_file = out / f"{case}.scenes.json"
    scenes = json.loads(scenes_file.read_text()) if scenes_file.exists() else []
    seconds = [s["durationMs"] / 1000 for s in scenes if s.get("durationMs")]
    result.update(scenes=len(scenes), longestScene=round(max(seconds, default=0), 1), meanScene=round(sum(seconds) / len(seconds), 1) if seconds else None)
    folder = out / case
    result["repetition"] = picture_repetition(folder) if folder.exists() else None
    result["captionEdge"] = caption_edge_hits(video, duration)
    gates = {
        "format 9:16 H.264/AAC": (v.get("width"), v.get("height")) == (1080, 1920) and v.get("codec_name") == "h264" and a.get("codec_name") == "aac" and v.get("pix_fmt") == "yuv420p",
        "no clipping (TP < -1 dBTP)": tp is not None and tp < -1.0,
        "no dead air (> 1.5 s)": longest <= 1.5,
        "no scene > 9 s": max(seconds, default=0) <= 9.0,
        "no repeated neighbour pictures": result["repetition"] is None or result["repetition"]["nearIdenticalNeighbours"] == 0,
    }
    result["gates"] = gates
    result["gatesPassed"] = sum(gates.values())
    return result


if __name__ == "__main__":
    out = Path(sys.argv[1])
    cases = sys.argv[2:] or sorted(p.stem for p in out.glob("B*.mp4"))
    rows = [evaluate(out, case) for case in cases]
    (out / "technical-gates.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    for r in rows:
        if not r.get("exists"):
            print(r["id"], "missing")
            continue
        failed = [k for k, ok in r["gates"].items() if not ok]
        print(f'{r["id"]} {r["duration"]}s {r["scenes"]} scenes  LUFS {r["lufs"]} TP {r["truePeak"]}  silence max {r["longestSilence"]}s  longest scene {r["longestScene"]}s  gates {r["gatesPassed"]}/{len(r["gates"])}  failed: {failed or "-"}  caption-edge look: {"yes" if r["captionEdge"] and r["captionEdge"]["edgePixels"] else "no"}')
