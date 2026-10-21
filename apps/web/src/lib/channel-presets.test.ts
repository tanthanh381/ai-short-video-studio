import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, DURATION_OPTIONS, VISUAL_PRESET_OPTIONS, VOICE_PRESETS, createVideoSchema, projectSettingsSchema, updateProjectSchema } from "@studio/shared";
import { CHANNEL_PRESETS, estimatedNarrationSeconds } from "./channel-presets";
import { withLayoutTemplate } from "./visual-preset";

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
    const bridgeStyle: Record<string, string> = {
      "cinematic-color": "photo", "ink-monochrome": "ink", cartoon: "flat", historical: "historical", watercolor: "watercolor",
      "paper-cut": "paper-cut", "chibi-co-phong": "chibi", "chibi-tien-hiep": "chibi", "chibi-dan-gian-viet": "chibi",
      "chibi-co-trang-hai": "chibi", "thuy-mac-co-phong": "ink", "thuy-mac-sepia": "ink-wash", "paper-storybook": "paper-cut", "chibi-huyen-bi": "chibi",
      "chibi-dong-vat-co-phong": "chibi", whiteboard: "whiteboard",
    };
    for (const option of VISUAL_PRESET_OPTIONS) {
      expect(bridgeStyle[option.id], `${option.id} has no bridge style`).toBeDefined();
      expect(bridge, `${option.id} -> ${bridgeStyle[option.id]}`).toMatch(new RegExp(`"${bridgeStyle[option.id]}": "`));
    }
  });

  it("exposes the requested video modes without removing the existing cổ nhân template", () => {
    expect(CHANNEL_PRESETS.map((preset) => preset.id)).toEqual([
      "dao-ly-co-phong",
      "ve-tay",
      "video-anh-dong-ai",
      "quy-tac-co-nhan",
    ]);
    expect(CHANNEL_PRESETS.map((preset) => preset.label)).toEqual(expect.arrayContaining([
      "Chibi cổ trang",
      "Giải thích vẽ tay",
      "Video ảnh động AI",
    ]));
  });

  it("keeps LTX out of the whiteboard preset", () => {
    const withLtx = { ...DEFAULT_PROJECT_SETTINGS, localModels: { ...DEFAULT_PROJECT_SETTINGS.localModels, video: "ltx" } };
    const settings = CHANNEL_PRESETS.find((preset) => preset.id === "ve-tay")!.apply(withLtx);
    expect(settings.visualPreset).toBe("whiteboard");
    expect(settings.localModels.video).toBeNull();
  });

  it("the Đạo lý cổ phong preset matches the 30-second reference format", () => {
    const settings = CHANNEL_PRESETS.find((preset) => preset.id === "dao-ly-co-phong")!.apply(DEFAULT_PROJECT_SETTINGS);
    expect(settings).toMatchObject({
      layoutTemplate: "paper-stage",
      visualPreset: "chibi-co-phong",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      autoMusic: true,
      captionHighlight: false,
      hookTitle: false,
      progressBar: false,
      sceneSfx: false,
      outroText: "",
    });
  });

  it("the cổ nhân preset is the sepia story card with sepia ink pictures and green karaoke captions", () => {
    const settings = CHANNEL_PRESETS.find((preset) => preset.id === "quy-tac-co-nhan")!.apply(DEFAULT_PROJECT_SETTINGS);
    expect(settings).toMatchObject({ layoutTemplate: "story-card", cardTheme: "sepia", visualPreset: "thuy-mac-sepia", captionHighlight: true, aspectRatio: "9:16", progressBar: true, sceneSfx: true, targetDurationSec: 45 });
    expect(settings.outroText).toMatch(/Theo dõi/u);
    // choosing the plain story card afterwards goes back to the blue one
    expect(withLayoutTemplate(settings, "story-card").cardTheme).toBe("blue");
    expect(withLayoutTemplate(settings, "full-bleed").layoutTemplate).toBe("full-bleed");
  });

  it("a later supported preset fully replaces the frame chosen by an earlier one", () => {
    const paper = CHANNEL_PRESETS.find((preset) => preset.id === "dao-ly-co-phong")!.apply(DEFAULT_PROJECT_SETTINGS);
    const whiteboard = CHANNEL_PRESETS.find((preset) => preset.id === "ve-tay")!.apply(paper);
    expect(whiteboard).toMatchObject({ layoutTemplate: "full-bleed", visualPreset: "whiteboard" });
  });

  it("leaving the paper stage gives readable captions back on a full-frame picture", () => {
    const paper = CHANNEL_PRESETS.find((preset) => preset.id === "dao-ly-co-phong")!.apply(DEFAULT_PROJECT_SETTINGS);
    expect(paper).toMatchObject({ layoutTemplate: "paper-stage", visualPreset: "chibi-co-phong", aspectRatio: "9:16", hookTitle: false, captionHighlight: false });
    expect(paper.subtitle.backgroundOpacity).toBe(0);
    for (const preset of CHANNEL_PRESETS.filter((item) => item.id === "ve-tay")) {
      const next = preset.apply(paper);
      expect(next.layoutTemplate, preset.id).toBe("full-bleed");
      expect(next.subtitle.fontColor, preset.id).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.fontColor);
      expect(next.subtitle.backgroundOpacity, preset.id).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.backgroundOpacity);
    }
    expect(CHANNEL_PRESETS.find((item) => item.id === "quy-tac-co-nhan")!.apply(paper).subtitle.fontColor).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.fontColor);
  });

  it("estimates narration length from words, the voice's pace and reading speed", () => {
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1)).toBe(109); // "Ăn khế trả vàng": a slow storyteller reads about 2.85 words a second, pauses included
    expect(estimatedNarrationSeconds(309, "doc-truyen", 1.2)).toBe(91);
    expect(estimatedNarrationSeconds(309, "triet-ly", 1)).toBe(99);
  });
});
