import { describe, expect, it } from "vitest";
import type { Scene } from "@studio/shared";
import { buildAudioMixFilter, sfxSource, validateCaptionTiming, EXPORT_AUDIO_BITS, EXPORT_LIMIT_BYTES, exportRateArgs, exportRateCap, exportTooLargeMessage } from "./render-quality";

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

describe("exports fit the storage limit", () => {
  it("caps the video bitrate by length so a 3-minute export stays under the 50 MiB bucket limit", () => {
    // Measured on a real 90 s story re-encoded to 180 s: 69.4 MiB at CRF 21 alone, 42.9 MiB capped (SSIM 0.984 to the uncapped).
    const bytes = (seconds: number) => ((exportRateCap(seconds * 1000).maxrate + EXPORT_AUDIO_BITS) * seconds) / 8;
    for (const seconds of [15, 30, 60, 90, 120, 180, 240])
      expect(bytes(seconds), `${seconds}s`).toBeLessThanOrEqual(EXPORT_LIMIT_BYTES * 0.87);
    expect(exportRateCap(180_000).maxrate).toBe(1_811_945);
    expect(exportRateCap(30_000).maxrate).toBeGreaterThan(10_000_000); // short videos are not touched
    expect(exportRateCap(120_000).maxrate).toBeLessThan(exportRateCap(60_000).maxrate);
  });

  it("a retry lowers the cap, never below a usable floor, and the buffer is twice the rate", () => {
    expect(exportRateCap(180_000, 0.7).maxrate).toBeLessThan(exportRateCap(180_000).maxrate);
    expect(exportRateCap(3_600_000).maxrate).toBe(400_000);
    expect(exportRateArgs(90_000)).toEqual(["-maxrate", String(exportRateCap(90_000).maxrate), "-bufsize", String(exportRateCap(90_000).maxrate * 2)]);
  });

  it("says in Vietnamese when a video cannot fit", () => {
    expect(exportTooLargeMessage(900_000)).toMatch(/900 giây.*50 MB.*chia thành nhiều phần/u);
  });
});

describe("scene-change ticks", () => {
  it("writes one decaying tick per cut inside the filter graph, and none for a cut outside the video", () => {
    const source = sfxSource([3300, 6100, 99_000], 10_000);
    expect(source.match(/between\(t-/gu)?.length).toBe(4); // two cuts, in each of the two channels
    expect(source).toContain("t-3.300");
    expect(source).toContain("t-6.100");
    expect(source).not.toContain("99.000");
    expect(source).toContain("d=10.000");
  });

  it("joins the ticks to the narration before the music ducks, and leaves the old graph untouched without cuts", () => {
    const withTicks = buildAudioMixFilter(true, 0.12, 10_000, 2, true, [3300]);
    expect(withTicks).toMatch(/^aevalsrc=.*\[sfx\];\[0:a\]aformat=.*\[vo\];\[vo\]\[sfx\]amix=inputs=2:duration=first:normalize=0\[v0\];\[v0\]asplit=2\[voice\]\[sidechain\];/u);
    expect(withTicks).toContain("[2:a]");
    expect(buildAudioMixFilter(false, 0.12, 10_000, 1, true, [3300])).toMatch(/\[v0\]loudnorm/u);
    expect(buildAudioMixFilter(true, 0.12, 10_000, 1, true, [])).toBe(buildAudioMixFilter(true, 0.12, 10_000, 1, true));
    expect(buildAudioMixFilter(true, 0.12, 10_000, 1, true, [])).toMatch(/^\[0:a\]aformat=.*,asplit=2\[voice\]\[sidechain\];/u);
  });
});
