import { describe, expect, it } from "vitest";
import type { Scene } from "@studio/shared";
import { buildAudioMixFilter, validateCaptionTiming } from "./render-quality";

const scene = (cues: Array<{ startMs: number; endMs: number; text: string }>) =>
  ({ order: 0, subtitles: cues.map((cue) => ({ id: crypto.randomUUID(), ...cue })) }) as Scene;
const valid = { startMs: 0, endMs: 1000, text: "Xin chao" };

describe("technical render quality", () => {
  it("accepts measured captions with small PCM rounding tolerance", () => {
    expect(() => validateCaptionTiming(scene([valid]), 995)).not.toThrow();
  });
  it("rejects missing enabled subtitles", () => {
    expect(() => validateCaptionTiming(scene([]), 1000)).toThrow(/missing/);
  });
  it.each([
    { ...valid, startMs: -1 }, { ...valid, endMs: 0 },
    { ...valid, endMs: 2000 }, { ...valid, text: "   " },
    { ...valid, startMs: Number.NaN }, { ...valid, endMs: Infinity },
  ])("rejects corrupt or out of bounds cues %#", (cue) => {
    expect(() => validateCaptionTiming(scene([cue]), 1000)).toThrow(/subtitle/);
  });
  it("rejects overlapping captions", () => {
    expect(() => validateCaptionTiming(scene([valid, { ...valid, startMs: 500 }]), 2000)).toThrow();
  });
  it("keeps voice gain and compensates limiter latency without music", () => {
    const filter = buildAudioMixFilter(false, 0.12, 60000);
    expect(filter).toContain("level=false:latency=true");
    expect(filter).not.toContain("sidechaincompress");
  });
  it("ducks music using speech without shortening the voice timeline", () => {
    const filter = buildAudioMixFilter(true, 0.12, 60000);
    expect(filter).toContain("asplit=2[voice][sidechain]");
    expect(filter).toContain("[music][sidechain]sidechaincompress");
    expect(filter).toContain("duration=first");
    expect(filter).toContain("st=59.000");
  });
  it.each([-1, 1.1, Number.NaN, Infinity])("rejects invalid gain %s", (gain) => {
    expect(() => buildAudioMixFilter(true, gain, 1000)).toThrow();
  });
});
