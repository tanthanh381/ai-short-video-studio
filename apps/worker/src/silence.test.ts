import { describe, expect, it } from "vitest";
import { trimWavSilence } from "./silence";

/** 16-bit mono WAV at 1 kHz sample rate: `silentMs` of zeros, `loudMs` of a square wave, `tailMs` of zeros. */
function wav(silentMs: number, loudMs: number, tailMs: number): Uint8Array {
  const samples = [...Array(silentMs).fill(0), ...Array.from({ length: loudMs }, (_, i) => (i % 2 ? 8000 : -8000)), ...Array(tailMs).fill(0)];
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => { out[offset + index] = char.charCodeAt(0); });
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 1000, true);
  view.setUint32(28, 2000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, value, true));
  return out;
}

describe("cutting silence keeps the subtitles in time", () => {
  it("cuts lead-in and tail silence and moves every cue by the lead-in", () => {
    const cues = [{ id: "a", text: "Xin chào ", startMs: 0, endMs: 900 }, { id: "b", text: "các bạn.", startMs: 900, endMs: 1800 }];
    const result = trimWavSilence(wav(300, 1000, 500), cues, { padMs: 60 });
    expect(result.durationMs).toBe(1120); // 60 + 1000 + 60
    expect(result.trimmedMs).toBe(680);
    expect(result.cues).toEqual([
      { id: "a", text: "Xin chào ", startMs: 0, endMs: 660 },
      { id: "b", text: "các bạn.", startMs: 660, endMs: 1120 },
    ]);
    expect(result.cues.map((cue) => cue.text).join("")).toBe("Xin chào các bạn.");
  });

  it("keeps cues ordered, inside the audio, and the last one ending with it", () => {
    const cues = [{ startMs: 0, endMs: 200 }, { startMs: 200, endMs: 400 }, { startMs: 400, endMs: 2000 }];
    const { cues: shifted, durationMs } = trimWavSilence(wav(350, 900, 750), cues);
    shifted.forEach((cue, index) => {
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
      if (index) expect(cue.startMs).toBeGreaterThanOrEqual(shifted[index - 1]!.endMs);
    });
    expect(shifted.at(-1)!.endMs).toBe(durationMs);
  });

  it("leaves silent or non-PCM audio unchanged", () => {
    const silent = wav(500, 0, 0);
    expect(trimWavSilence(silent, [{ startMs: 0, endMs: 500 }]).wav).toBe(silent);
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
    expect(trimWavSilence(mp3, []).wav).toBe(mp3);
  });
});
