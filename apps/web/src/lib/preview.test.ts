import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "@studio/shared";
import { previewImageForSettings } from "./preview";

describe("creation preview", () => {
  it("uses the selected story-card frame instead of a generic visual", () => {
    expect(previewImageForSettings({ ...DEFAULT_PROJECT_SETTINGS, layoutTemplate: "story-card", cardTheme: "sepia" })).toBe("ink-wash-sepia.jpg");
    expect(previewImageForSettings({ ...DEFAULT_PROJECT_SETTINGS, layoutTemplate: "story-card", cardTheme: "blurred" })).toBe("cinematic-reading.jpg");
  });

  it("follows the selected full-bleed visual preset", () => {
    expect(previewImageForSettings({ ...DEFAULT_PROJECT_SETTINGS, visualPreset: "watercolor" })).toBe("watercolor-healing.jpg");
    expect(previewImageForSettings({ ...DEFAULT_PROJECT_SETTINGS, visualPreset: "whiteboard" })).toBe("whiteboard-learning.jpg");
  });
});
