import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, VOICE_PRESETS, projectSettingsSchema } from "@studio/shared";
import { CHANNEL_PRESETS, estimatedNarrationSeconds } from "./channel-presets";

describe("channel presets", () => {
  it("every preset produces valid settings with a known voice and music on", () => {
    for (const preset of CHANNEL_PRESETS) {
      const settings = preset.apply(DEFAULT_PROJECT_SETTINGS);
      expect(projectSettingsSchema.safeParse(settings).success).toBe(true);
      expect(VOICE_PRESETS.some((voice) => voice.id === settings.voice)).toBe(true);
      expect(settings.autoMusic).toBe(true);
      expect(settings.voiceSpeed).toBe(1); // the voice bridge normalises each voice to the short-form pace
    }
  });

  it("the folk-tale preset uses the illustrated story card", () => {
    const settings = CHANNEL_PRESETS.find((preset) => preset.id === "co-tich")!.apply(DEFAULT_PROJECT_SETTINGS);
    expect(settings).toMatchObject({ layoutTemplate: "story-card", visualPreset: "cartoon", voice: "doc-truyen" });
  });

  it("a later preset fully replaces the frame chosen by an earlier one", () => {
    const tale = CHANNEL_PRESETS[0]!.apply(DEFAULT_PROJECT_SETTINGS);
    const knowledge = CHANNEL_PRESETS.find((preset) => preset.id === "kien-thuc")!.apply(tale);
    expect(knowledge).toMatchObject({ layoutTemplate: "full-bleed", visualPreset: "cinematic-color" });
  });

  it("estimates narration length from words, the voice's pace and reading speed", () => {
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1)).toBe(84); // "Ăn khế trả vàng" at the normalised pace
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1.2)).toBe(70);
    expect(estimatedNarrationSeconds(309, "triet-ly", 1)).toBe(91); // a calmer voice takes longer
  });
});
