/**
 * Where the channel logo goes on the video. One function for the MP4 (the worker turns it into FFmpeg overlay
 * expressions) and for the studio preview (the web turns it into CSS), so what the person sees before exporting is
 * what the export draws.
 */
import type { ProjectSettings } from "./schemas";

/** Where TikTok, Reels and Shorts draw their own interface over a 1080x1920 video (tabs on top, caption and buttons below). */
export const PLATFORM_SAFE = { top: 230, bottom: 500, side: 64 } as const;
/** The story card's picture band (1080x1920 frame). */
export const STORY_BAND = { top: 625, bottom: 1300 } as const;
/** The paper stage's captions start here (1080x1920 frame); a logo stays above them. */
export const PAPER_CAPTION_TOP = 1320;
/** Inside the story card's picture band: this far from its top or bottom edge, and from the frame's side. */
const BAND_INSET = { y: 24, side: 56 };

export type LogoAnchor = {
  /** Logo width in pixels of the frame. */
  width: number;
  /** Dragged by hand: the export keeps the whole logo inside the frame whatever its height. */
  custom?: true;
  /** "center": centred; otherwise the distance of the logo's edge from that side of the frame. */
  x: { from: "left" | "right"; px: number } | { from: "center" };
  y: { from: "top" | "bottom"; px: number };
};

type LogoSettings = Pick<ProjectSettings, "logoPosition" | "logoScale" | "aspectRatio"> &
  Partial<Pick<ProjectSettings, "layoutTemplate" | "subtitle" | "logoX" | "logoY">>;

export function logoAnchor(settings: LogoSettings, frame: { width: number; height: number }): LogoAnchor {
  const { width, height } = frame;
  const position = settings.logoPosition;
  const logoWidth = Math.round(width * settings.logoScale);
  const portrait = height > width;
  const storyCard = settings.layoutTemplate === "story-card" && settings.aspectRatio === "9:16";
  const paperStage = settings.layoutTemplate === "paper-stage" && settings.aspectRatio === "9:16";

  // Placed by hand: exactly where it was dropped, kept inside the frame.
  if (position === "custom") {
    const left = Math.round(Math.min(Math.max(settings.logoX ?? 0, 0), 1) * width);
    const top = Math.round(Math.min(Math.max(settings.logoY ?? 0, 0), 1) * height);
    return { width: logoWidth, custom: true, x: { from: "left", px: Math.min(left, width - logoWidth) }, y: { from: "top", px: top } };
  }

  // Story cards: in a corner of the picture band, clear of the title above it and the captions below it.
  if (storyCard) {
    const x = position === "top-center" ? { from: "center" as const } : { from: position.endsWith("left") ? "left" as const : "right" as const, px: BAND_INSET.side };
    const y = position.startsWith("bottom")
      ? { from: "bottom" as const, px: height - STORY_BAND.bottom + BAND_INSET.y }
      : { from: "top" as const, px: STORY_BAND.top + BAND_INSET.y };
    return { width: logoWidth, x, y };
  }

  const margin = portrait ? PLATFORM_SAFE.side : Math.round(width * 0.04);
  const top = portrait ? PLATFORM_SAFE.top : margin;
  let bottom = portrait ? PLATFORM_SAFE.bottom : margin;
  // A bottom logo must not sit on the captions: above the paper stage's captions, or above bottom subtitles.
  if (paperStage) bottom = height - PAPER_CAPTION_TOP + BAND_INSET.y;
  else if (portrait && settings.subtitle?.enabled !== false && (settings.subtitle?.position ?? "bottom") === "bottom") bottom = Math.max(bottom, Math.round(height * 0.34));
  const x = position === "top-center" ? { from: "center" as const } : { from: position.endsWith("right") ? "right" as const : "left" as const, px: margin };
  const y = position.startsWith("bottom") ? { from: "bottom" as const, px: bottom } : { from: "top" as const, px: top };
  return { width: logoWidth, x, y };
}

/** The anchor as FFmpeg overlay expressions (W/H: the video, w/h: the logo). */
export function logoOverlayXY(anchor: LogoAnchor): { x: string; y: string } {
  // a hand-placed logo's height is only known to FFmpeg: it is kept inside the frame there
  if (anchor.custom && anchor.x.from === "left" && anchor.y.from === "top") return { x: `'min(W-w,${anchor.x.px})'`, y: `'min(H-h,${anchor.y.px})'` };
  const x = anchor.x.from === "center" ? "(W-w)/2" : anchor.x.from === "right" ? `W-w-${anchor.x.px}` : `${anchor.x.px}`;
  const y = anchor.y.from === "bottom" ? `H-h-${anchor.y.px}` : `${anchor.y.px}`;
  return { x, y };
}
