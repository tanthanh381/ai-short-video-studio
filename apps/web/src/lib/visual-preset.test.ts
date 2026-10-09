import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, VISUAL_PRESET_OPTIONS } from "@studio/shared";
import { withLayoutTemplate, withVisualPreset } from "./visual-preset";

describe("withVisualPreset", () => {
  it("copies the preset description for every preset", () => {
    for (const option of VISUAL_PRESET_OPTIONS) {
      const next = withVisualPreset(DEFAULT_PROJECT_SETTINGS, option.id);
      expect(next.visualPreset).toBe(option.id);
      expect(next.visualStyle).toBe(option.description);
    }
  });

  it("uses dark-on-cream subtitles for ink and restores the defaults when leaving it", () => {
    const ink = withVisualPreset(DEFAULT_PROJECT_SETTINGS, "ink-monochrome");
    expect(ink.subtitle.fontColor).toBe("#171717");
    expect(ink.subtitle.backgroundOpacity).toBe(0.94);
    const back = withVisualPreset(ink, "watercolor");
    expect(back.subtitle).toEqual(DEFAULT_PROJECT_SETTINGS.subtitle);
  });

  it("keeps the viewer's own subtitle choices when neither side is ink", () => {
    const custom = { ...DEFAULT_PROJECT_SETTINGS, subtitle: { ...DEFAULT_PROJECT_SETTINGS.subtitle, fontColor: "#FFEE00" } };
    expect(withVisualPreset(custom, "paper-cut").subtitle.fontColor).toBe("#FFEE00");
  });
});

describe("withLayoutTemplate", () => {
  it("story card switches to the cartoon look, 9:16 and auto music", () => {
    const next = withLayoutTemplate({ ...DEFAULT_PROJECT_SETTINGS, aspectRatio: "16:9" }, "story-card");
    expect(next).toMatchObject({ layoutTemplate: "story-card", visualPreset: "cartoon", aspectRatio: "9:16", autoMusic: true });
  });

  it("full-bleed only changes the template", () => {
    const next = withLayoutTemplate({ ...DEFAULT_PROJECT_SETTINGS, visualPreset: "watercolor" }, "full-bleed");
    expect(next.layoutTemplate).toBe("full-bleed");
    expect(next.visualPreset).toBe("watercolor");
  });
});
