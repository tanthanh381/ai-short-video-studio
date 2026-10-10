import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, DURATION_OPTIONS, VISUAL_PRESET_OPTIONS, VOICE_PRESETS, createVideoSchema, projectSettingsSchema, updateProjectSchema } from "@studio/shared";
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

  it("the API accepts every request the create page can send: preset x length x start mode x picture style x frame", () => {
    // The web and the API share these schemas, but a value the page offers and the API rejects is a 400 on the live site.
    const withVoiceSpeeds = [0.8, 1, 1.3]; // the video slider's range (the TTS page has its own, 0.75-1.25)
    for (const preset of CHANNEL_PRESETS)
      for (const seconds of DURATION_OPTIONS)
        for (const inputMode of ["idea", "full-script"] as const) {
          const settings = { ...preset.apply(DEFAULT_PROJECT_SETTINGS), targetDurationSec: seconds };
          const request = createVideoSchema.safeParse({ sourceText: "Một ý tưởng đủ dài để gửi.", inputMode, settings });
          expect(request.success, `${preset.id} ${seconds}s ${inputMode}`).toBe(true);
          expect(updateProjectSchema.safeParse({ settings }).success, `update ${preset.id}`).toBe(true);
        }
    for (const option of VISUAL_PRESET_OPTIONS)
      for (const layout of ["full-bleed", "story-card", "paper-stage"] as const)
        for (const voiceSpeed of withVoiceSpeeds)
          for (const aspectRatio of ["9:16", "1:1", "16:9"] as const)
            expect(projectSettingsSchema.safeParse({ ...DEFAULT_PROJECT_SETTINGS, visualPreset: option.id, layoutTemplate: layout, voiceSpeed, aspectRatio }).success, `${option.id} ${layout} ${voiceSpeed} ${aspectRatio}`).toBe(true);
  });

  it("every picture style on offer is known to the image bridge", async () => {
    const { readFileSync } = await import("node:fs");
    const bridge = readFileSync(new URL("../../../../local-tools/media_server.py", import.meta.url), "utf8");
    // preset id -> bridge style, as in apps/worker/src/providers.ts PRESET_IMAGE_STYLE (cinematic-color falls back to photo)
    const bridgeStyle: Record<string, string> = { "cinematic-color": "photo", "ink-monochrome": "ink", cartoon: "flat", historical: "historical", watercolor: "watercolor", "paper-cut": "paper-cut", "chibi-co-phong": "chibi", whiteboard: "whiteboard" };
    for (const option of VISUAL_PRESET_OPTIONS) {
      expect(bridgeStyle[option.id], `${option.id} has no bridge style`).toBeDefined();
      expect(bridge, `${option.id} -> ${bridgeStyle[option.id]}`).toMatch(new RegExp(`"${bridgeStyle[option.id]}": "`));
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

  it("leaving the paper stage gives readable captions back on a full-frame picture", () => {
    const paper = CHANNEL_PRESETS.find((preset) => preset.id === "dao-ly-co-phong")!.apply(DEFAULT_PROJECT_SETTINGS);
    expect(paper).toMatchObject({ layoutTemplate: "paper-stage", visualPreset: "chibi-co-phong", aspectRatio: "9:16", hookTitle: false, captionHighlight: false });
    expect(paper.subtitle.backgroundOpacity).toBe(0);
    for (const preset of CHANNEL_PRESETS.filter((item) => item.id !== "dao-ly-co-phong" && item.id !== "co-tich")) {
      const next = preset.apply(paper);
      expect(next.layoutTemplate, preset.id).toBe("full-bleed");
      expect(next.subtitle.fontColor, preset.id).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.fontColor);
      expect(next.subtitle.backgroundOpacity, preset.id).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.backgroundOpacity);
    }
    expect(CHANNEL_PRESETS.find((item) => item.id === "co-tich")!.apply(paper).subtitle.fontColor).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.fontColor);
  });

  it("estimates narration length from words, the voice's pace and reading speed", () => {
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1)).toBe(84); // "Ăn khế trả vàng" at the normalised pace
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1.2)).toBe(70);
    expect(estimatedNarrationSeconds(309, "triet-ly", 1)).toBe(91); // a calmer voice takes longer
  });
});
