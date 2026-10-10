"""CLI wrapper for VieNeu-TTS v3 Nano on Apple Silicon/macOS CPU."""

from __future__ import annotations

import argparse
from pathlib import Path

from vieneu import Vieneu


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="Đức Trí")
    parser.add_argument("--text")
    parser.add_argument("--text-file")
    parser.add_argument("--out", default="work/local-ai/output/vieneu-voiceover.wav")
    parser.add_argument("--steps", type=int, default=16)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--sway", type=float, default=None)
    parser.add_argument("--list-voices", action="store_true")
    args = parser.parse_args()

    tts = Vieneu(mode="v3nano")
    if args.list_voices:
        for label, voice_id in tts.list_preset_voices():
            print(f"{voice_id}\t{label}")
        return

    if not args.text and not args.text_file:
        parser.error("Provide --text or --text-file")
    text = args.text or Path(args.text_file).read_text(encoding="utf-8")
    text = " ".join(line.strip() for line in text.splitlines() if line.strip())
    kwargs = {"voice": args.voice, "steps": args.steps, "speed": args.speed}
    if args.sway is not None:
        kwargs["sway"] = args.sway
    audio = tts.infer(text, **kwargs)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    tts.save(audio, str(output))
    print(f"Wrote {output} ({len(audio) / tts.sample_rate:.2f}s, {tts.sample_rate} Hz)")


if __name__ == "__main__":
    main()
