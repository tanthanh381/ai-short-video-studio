import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DURATION_OPTIONS, VOICE_MOOD, contentPlan, durationLabel, narrationSeconds, paceCorrection, wordBudget } from "./duration";
import { VOICE_PRESETS } from "./voices";
import { projectSettingsSchema } from "./schemas";

describe("video length from an idea", () => {
  it("budgets words for the voice's real pace (3.7 w/s × mood × speed), within ±10%", () => {
    expect(wordBudget(60, "thuyet-minh")).toEqual({ target: 226, min: 203, max: 249 });
    // A calmer voice reads fewer words in the same minute; a faster reading speed more.
    expect(wordBudget(60, "triet-ly").target).toBeLessThan(wordBudget(60, "nang-dong").target);
    expect(wordBudget(30, "doc-truyen", 1.2).target).toBe(133);
    for (const seconds of DURATION_OPTIONS) {
      const { target } = wordBudget(seconds, "tam-su");
      expect(Math.abs(narrationSeconds(target, "tam-su") - seconds)).toBeLessThan(0.5);
    }
  });

  it("plans more points for longer videos and the beats add up to the budget", () => {
    const points = (seconds: number) => contentPlan(seconds, "kien-thuc", "thuyet-minh").beats.length - 2;
    expect(DURATION_OPTIONS.map(points)).toEqual([1, 2, 3, 3, 4, 5, 7]);
    for (const style of ["kien-thuc", "ke-chuyen", "truyen-cam-hung", "meo-cuoc-song"])
      for (const seconds of DURATION_OPTIONS) {
        const plan = contentPlan(seconds, style, "doc-truyen");
        const sum = plan.beats.reduce((total, beat) => total + beat.words, 0);
        expect(Math.abs(sum - plan.words.target), `${style} ${seconds}s`).toBeLessThanOrEqual(1);
        expect(plan.beats[0]!.label).toBe("Mở đầu");
        expect(plan.beats.at(-1)!.label).toBe("Kết");
        expect(plan.beats.every((beat) => beat.words >= 6)).toBe(true);
      }
  });

  it("gives a story a turn even at 15 seconds and more events when longer", () => {
    expect(contentPlan(15, "ke-chuyen", "doc-truyen").beats.map((beat) => beat.label)).toEqual(["Mở đầu", "Bước ngoặt", "Kết"]);
    expect(contentPlan(90, "ke-chuyen", "doc-truyen").beats.map((beat) => beat.label))
      .toEqual(["Mở đầu", "Bối cảnh", "Diễn biến 1", "Diễn biến 2", "Bước ngoặt", "Kết"]);
    expect(contentPlan(90, "ke-chuyen", "doc-truyen").summary).toBe("Mở đầu → Bối cảnh → 2 diễn biến → Bước ngoặt → Kết");
    expect(contentPlan(15, "ke-chuyen", "doc-truyen").summary).toBe("Mở đầu → Bước ngoặt → Kết");
  });

  it("accepts every duration on offer and rejects others", () => {
    for (const seconds of DURATION_OPTIONS) expect(projectSettingsSchema.parse({ targetDurationSec: seconds }).targetDurationSec).toBe(seconds);
    expect(() => projectSettingsSchema.parse({ targetDurationSec: 75 })).toThrow();
  });

  it("corrects the reading speed only when the voiced length misses by more than 8%, never by more than 12%", () => {
    expect(paceCorrection(50_200, 60)).toBe(0.88); // the measured "1 phút" at 50 s: read slower, clamped
    expect(paceCorrection(57_000, 60)).toBeNull(); // within 8%
    expect(paceCorrection(33_600, 30)).toBeCloseTo(1.12); // too long: read faster
    expect(paceCorrection(32_700, 30)).toBeCloseTo(1.09);
    expect(paceCorrection(0, 60)).toBeNull();
  });

  it("labels durations in Vietnamese", () => {
    expect(DURATION_OPTIONS.map(durationLabel)).toEqual(["15 giây", "30 giây", "45 giây", "1 phút", "1 phút 30 giây", "2 phút", "3 phút"]);
  });

  it("knows the mood of every voice, the same as the voice bridge uses", () => {
    expect(Object.keys(VOICE_MOOD).sort()).toEqual(VOICE_PRESETS.map((preset) => preset.id).sort());
    const bridge = readFileSync(join(__dirname, "../../../local-tools/media_server.py"), "utf8");
    for (const [voice, mood] of Object.entries(VOICE_MOOD)) {
      const match = bridge.match(new RegExp(`"${voice}": \\("[^"]+", ([\\d.]+), [\\d.]+\\)`));
      expect(match, voice).not.toBeNull();
      expect(Number(match![1]), voice).toBe(mood);
    }
    expect(bridge).toMatch(/PACE_TARGET_WPS = float\(os\.getenv\("PACE_TARGET_WPS", "3\.7"\)\)/);
  });
});
