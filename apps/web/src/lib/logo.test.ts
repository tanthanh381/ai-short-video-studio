import { DEFAULT_PROJECT_SETTINGS } from "@studio/shared";
import { describe, expect, it } from "vitest";
import { logoPreviewStyle, looksLikeRoundLogoOnSquare } from "./logo";

const settings = { ...DEFAULT_PROJECT_SETTINGS, aspectRatio: "9:16" as const, logoScale: 0.14, logoOpacity: 0.9 };

describe("logoPreviewStyle", () => {
  it("places the preview logo where the MP4 puts it", () => {
    expect(logoPreviewStyle({ ...settings, layoutTemplate: "story-card", logoPosition: "top-left" }))
      .toEqual({ width: "13.981%", opacity: "0.9", left: "5.185%", top: "33.802%" });
    expect(logoPreviewStyle({ ...settings, layoutTemplate: "full-bleed", logoPosition: "top-center" }))
      .toMatchObject({ left: "50%", transform: "translateX(-50%)", top: "11.979%" });
  });
});

describe("looksLikeRoundLogoOnSquare", () => {
  const image = (width: number, height: number, corner: [number, number, number, number]) => ({ width, height, at: () => corner });
  it("spots a square picture with white, opaque corners", () => {
    expect(looksLikeRoundLogoOnSquare(image(960, 960, [255, 255, 255, 255]))).toBe(true);
  });
  it("leaves transparent, coloured or wide logos alone", () => {
    expect(looksLikeRoundLogoOnSquare(image(960, 960, [255, 255, 255, 0]))).toBe(false);
    expect(looksLikeRoundLogoOnSquare(image(960, 960, [20, 60, 120, 255]))).toBe(false);
    expect(looksLikeRoundLogoOnSquare(image(1200, 400, [255, 255, 255, 255]))).toBe(false);
  });
});
