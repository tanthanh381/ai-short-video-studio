import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "./index";
import { logoAnchor, logoOverlayXY, PLATFORM_SAFE, STORY_BAND } from "./logo";

const portrait = { width: 1080, height: 1920 };
const base = { logoScale: 0.14, aspectRatio: "9:16" as const };

describe("logoAnchor", () => {
  it("defaults to the platform-safe upper-left corner", () => {
    expect(DEFAULT_PROJECT_SETTINGS.logoPosition).toBe("top-left");
    expect(logoAnchor(DEFAULT_PROJECT_SETTINGS, portrait)).toEqual({
      width: 151,
      x: { from: "left", px: PLATFORM_SAFE.side },
      y: { from: "top", px: PLATFORM_SAFE.top },
    });
  });

  it("story cards honour the chosen corner, inside the picture band", () => {
    const card = (logoPosition: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right") =>
      logoAnchor({ ...base, logoPosition, layoutTemplate: "story-card" }, portrait);
    expect(card("top-left")).toEqual({ width: 151, x: { from: "left", px: 56 }, y: { from: "top", px: STORY_BAND.top + 24 } });
    expect(card("top-right").x).toEqual({ from: "right", px: 56 });
    expect(card("top-center").x).toEqual({ from: "center" });
    expect(card("bottom-right").y).toEqual({ from: "bottom", px: 1920 - STORY_BAND.bottom + 24 });
  });

  it("uses the size the person chose, with no hidden minimum", () => {
    expect(logoAnchor({ ...base, logoScale: 0.08, logoPosition: "top-right", layoutTemplate: "story-card" }, portrait).width).toBe(86);
  });

  it("keeps a full-frame portrait logo out of the phone apps' bars and off bottom subtitles", () => {
    const top = logoAnchor({ ...base, logoPosition: "top-left", layoutTemplate: "full-bleed" }, portrait);
    expect(top).toEqual({ width: 151, x: { from: "left", px: PLATFORM_SAFE.side }, y: { from: "top", px: PLATFORM_SAFE.top } });
    const bottom = logoAnchor({ ...base, logoPosition: "bottom-right", layoutTemplate: "full-bleed", subtitle: { enabled: true, position: "bottom" } as never }, portrait);
    expect(bottom.y).toEqual({ from: "bottom", px: Math.round(1920 * 0.34) });
    const noSubs = logoAnchor({ ...base, logoPosition: "bottom-right", layoutTemplate: "full-bleed", subtitle: { enabled: false, position: "bottom" } as never }, portrait);
    expect(noSubs.y).toEqual({ from: "bottom", px: PLATFORM_SAFE.bottom });
  });

  it("puts a bottom logo above the paper stage's captions", () => {
    expect(logoAnchor({ ...base, logoPosition: "bottom-left", layoutTemplate: "paper-stage" }, portrait).y).toEqual({ from: "bottom", px: 1920 - 1320 + 24 });
  });

  it("uses a plain 4% margin on landscape and square videos", () => {
    expect(logoAnchor({ logoScale: 0.1, aspectRatio: "16:9", logoPosition: "bottom-right", layoutTemplate: "full-bleed" }, { width: 1920, height: 1080 }))
      .toEqual({ width: 192, x: { from: "right", px: 77 }, y: { from: "bottom", px: 77 } });
  });
});

describe("logoOverlayXY", () => {
  it("turns an anchor into FFmpeg overlay expressions", () => {
    expect(logoOverlayXY({ width: 100, x: { from: "right", px: 56 }, y: { from: "bottom", px: 644 } })).toEqual({ x: "W-w-56", y: "H-h-644" });
    expect(logoOverlayXY({ width: 100, x: { from: "center" }, y: { from: "top", px: 649 } })).toEqual({ x: "(W-w)/2", y: "649" });
  });
});

describe("hand-placed logo", () => {
  it("goes exactly where it was dropped, as a share of the frame", () => {
    const anchor = logoAnchor({ logoScale: 0.14, aspectRatio: "9:16", logoPosition: "custom", logoX: 0.5, logoY: 0.25, layoutTemplate: "story-card" }, { width: 1080, height: 1920 });
    expect(anchor).toEqual({ width: 151, custom: true, x: { from: "left", px: 540 }, y: { from: "top", px: 480 } });
    expect(logoOverlayXY(anchor)).toEqual({ x: "'min(W-w,540)'", y: "'min(H-h,480)'" });
  });

  it("never leaves the frame", () => {
    const anchor = logoAnchor({ logoScale: 0.2, aspectRatio: "9:16", logoPosition: "custom", logoX: 1, logoY: 1 }, { width: 1080, height: 1920 });
    expect(anchor.x).toEqual({ from: "left", px: 1080 - 216 });
    expect(logoOverlayXY(anchor).y).toBe("'min(H-h,1920)'");
  });
});
