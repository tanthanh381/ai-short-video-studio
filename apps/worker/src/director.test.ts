import { describe, expect, it } from "vitest";
import { directorStoryboardResult, estimateSceneMs, platformDefaults, sceneWantsMotion } from "./director";
import type { ProductionPlan } from "@studio/shared";

const plan: ProductionPlan = {
  platform: "tiktok",
  hook: { text: "Bạn có biết?", visual: "close-up" },
  pacing: "fast",
  cta: "Theo dõi để xem thêm",
  motionScenes: [0, 2],
  scenes: [
    { narration: "Câu mở đầu gây tò mò.", imagePrompt: "a curious boy, close up" },
    { narration: "Nội dung chính ở đây.", imagePrompt: "a boy thinking" },
    { narration: "Chốt lại và kêu gọi.", imagePrompt: "a boy smiling" },
  ],
};

describe("directorStoryboardResult", () => {
  it("maps plan scenes to the storyboard-result shape with estimated durations", () => {
    const result = directorStoryboardResult(plan);
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]).toMatchObject({ narration: "Câu mở đầu gây tò mò.", imagePrompt: "a curious boy, close up" });
    expect(result.scenes[0]!.estimatedDurationMs).toBeGreaterThanOrEqual(2_000);
    expect(result.narration).toContain("Nội dung chính");
    expect(result.suggestedTitle).toBe("Bạn có biết?"); // uses the hook
  });
  it("falls back to the first narration for the title when the hook is empty", () => {
    const result = directorStoryboardResult({ ...plan, hook: { text: "", visual: "" } });
    expect(result.suggestedTitle).toBe("Câu mở đầu gây tò mò.");
  });
});

describe("estimateSceneMs", () => {
  it("clamps between 2s and 15s", () => {
    expect(estimateSceneMs("một")).toBe(2_000);
    expect(estimateSceneMs(Array(200).fill("từ").join(" "))).toBe(15_000);
  });
});

describe("sceneWantsMotion", () => {
  it("director mode animates exactly the planned scenes", () => {
    const base = { hasMotionModel: true, motionScenes: [0, 2], paperStage: true };
    expect(sceneWantsMotion({ ...base, sceneOrder: 0 })).toBe(true);
    expect(sceneWantsMotion({ ...base, sceneOrder: 1 })).toBe(false);
    expect(sceneWantsMotion({ ...base, sceneOrder: 2 })).toBe(true);
  });
  it("pipeline mode: paper-stage animates only the opening scene", () => {
    const base = { hasMotionModel: true, motionScenes: null, paperStage: true };
    expect(sceneWantsMotion({ ...base, sceneOrder: 0 })).toBe(true);
    expect(sceneWantsMotion({ ...base, sceneOrder: 1 })).toBe(false);
  });
  it("pipeline mode: non-paper-stage animates every scene", () => {
    expect(sceneWantsMotion({ hasMotionModel: true, motionScenes: null, paperStage: false, sceneOrder: 3 })).toBe(true);
  });
  it("never animates without a motion model", () => {
    expect(sceneWantsMotion({ hasMotionModel: false, motionScenes: [0], paperStage: false, sceneOrder: 0 })).toBe(false);
  });
});

describe("platformDefaults", () => {
  it("returns TikTok defaults with fast duration and progress bar", () => {
    const d = platformDefaults("tiktok");
    expect(d.targetDurationSec).toBe(30);
    expect(d.captionHighlight).toBe(true);
    expect(d.hookTitle).toBe(true);
    expect(d.progressBar).toBe(true);
  });
  it("returns Reels defaults without progress bar", () => {
    const d = platformDefaults("reels");
    expect(d.targetDurationSec).toBe(45);
    expect(d.progressBar).toBe(false);
  });
  it("returns Shorts defaults", () => {
    const d = platformDefaults("shorts");
    expect(d.targetDurationSec).toBe(45);
    expect(d.hookTitle).toBe(true);
  });
  it("returns Facebook defaults without hook title", () => {
    const d = platformDefaults("facebook");
    expect(d.targetDurationSec).toBe(60);
    expect(d.hookTitle).toBe(false);
    expect(d.progressBar).toBe(true);
  });
  it("returns empty for null platform", () => {
    expect(platformDefaults(null)).toEqual({});
    expect(platformDefaults(undefined)).toEqual({});
  });
});
