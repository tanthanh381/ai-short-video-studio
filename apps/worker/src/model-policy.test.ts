import { describe, expect, it } from "vitest";
import { writerModelForSettings } from "./model-policy";

const config = { defaultModel: "qwen3.5:4b", fastModel: "qwen2.5:3b", qualityModel: "qwen3:8b" };
const settings = (generationPreset: "fast" | "balanced" | "quality", storyboard: string | null = null) => ({
  generationPreset, localModels: { storyboard, image: null, video: null, tts: null, transcribe: null },
});

describe("writer model policy", () => {
  it("keeps an explicit project model", () => {
    expect(writerModelForSettings(settings("quality", "custom:latest"), [], config)).toBe("custom:latest");
  });
  it("uses the lighter model for Fast when it is installed", () => {
    expect(writerModelForSettings(settings("fast"), ["qwen2.5:3b", "qwen3.5:4b"], config)).toBe("qwen2.5:3b");
  });
  it("uses Qwen3 8B only for Quality and only when available", () => {
    expect(writerModelForSettings(settings("quality"), ["qwen3:8b", "qwen3.5:4b"], config)).toBe("qwen3:8b");
    expect(writerModelForSettings(settings("quality"), ["qwen3.5:4b"], config)).toBe("qwen3.5:4b");
  });
});
