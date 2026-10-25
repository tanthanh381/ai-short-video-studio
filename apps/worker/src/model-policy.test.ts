import { describe, expect, it } from "vitest";
import { writerModelForSettings } from "./model-policy";

const config = { defaultModel: "qwen3.5:4b", fastModel: "qwen3.5:4b", qualityModel: "qwen3.5:4b" };
const settings = (generationPreset: "fast" | "balanced" | "quality", storyboard: string | null = null) => ({
  generationPreset, localModels: { storyboard, image: null, video: null, tts: null, transcribe: null },
});

describe("writer model policy", () => {
  it("keeps an explicit project model", () => {
    expect(writerModelForSettings(settings("quality", "custom:latest"), [], config)).toBe("custom:latest");
  });
  it("uses qwen3.5:4b for Fast when it is installed", () => {
    expect(writerModelForSettings(settings("fast"), ["qwen3.5:4b"], config)).toBe("qwen3.5:4b");
  });
  it("uses qwen3.5:4b for Quality (single model setup)", () => {
    expect(writerModelForSettings(settings("quality"), ["qwen3.5:4b"], config)).toBe("qwen3.5:4b");
  });
});
