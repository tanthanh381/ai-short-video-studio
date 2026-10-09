import type { ProjectSettings } from "@studio/shared";
import { withLayoutTemplate, withVisualPreset } from "./visual-preset";

/**
 * One-click looks for common faceless channel niches. Each sets the picture style, frame, voice, reading pace and
 * music together, so a video does not end up as a folk tale in photoreal faces with no music.
 */
export const CHANNEL_PRESETS: Array<{ id: string; label: string; hint: string; apply: (settings: ProjectSettings) => ProjectSettings }> = [
  {
    id: "co-tich",
    label: "Truyện cổ tích",
    hint: "Thẻ truyện, tranh hoạt hình, giọng đọc truyện, nhạc nền",
    apply: (s) => ({ ...withLayoutTemplate(s, "story-card"), style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1.15, autoMusic: true, captionHighlight: true }),
  },
  {
    id: "chua-lanh",
    label: "Triết lý · chữa lành",
    hint: "Tranh màu nước, giọng trầm, nhịp vừa, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(s, "watercolor"), layoutTemplate: "full-bleed", style: "truyen-cam-hung", voice: "triet-ly", voiceSpeed: 1.05, autoMusic: true, captionHighlight: true }),
  },
  {
    id: "co-trang",
    label: "Cổ trang · kiếm hiệp",
    hint: "Bối cảnh cổ trang điện ảnh, giọng cổ trang, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(s, "historical"), layoutTemplate: "full-bleed", style: "ke-chuyen", voice: "co-trang", voiceSpeed: 1.1, autoMusic: true, captionHighlight: true }),
  },
  {
    id: "tam-su",
    label: "Tâm sự · cảm xúc",
    hint: "Tranh cắt giấy, giọng nữ ấm, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(s, "paper-cut"), layoutTemplate: "full-bleed", style: "truyen-cam-hung", voice: "tam-su", voiceSpeed: 1.05, autoMusic: true, captionHighlight: true }),
  },
  {
    id: "kien-thuc",
    label: "Kiến thức · mẹo hay",
    hint: "Ảnh chân thực, giọng thuyết minh nhanh, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(s, "cinematic-color"), layoutTemplate: "full-bleed", style: "kien-thuc", voice: "thuyet-minh", voiceSpeed: 1.2, autoMusic: true, captionHighlight: true }),
  },
];

/** Local narration reads about 2.9 words per second at normal speed, pauses included (measured on exports). */
export function estimatedNarrationSeconds(wordCount: number, voiceSpeed: number): number {
  return Math.round(wordCount / (2.9 * Math.max(0.5, voiceSpeed)));
}
