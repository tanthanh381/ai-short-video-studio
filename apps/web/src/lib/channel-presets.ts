import { narrationSeconds, type ProjectSettings } from "@studio/shared";
import { withLayoutTemplate, withVisualPreset } from "./visual-preset";

/**
 * One-click looks for common faceless channel niches. Reading speed stays 1.0: the voice bridge already brings
 * every voice to the short-form pace (about 3.7 words per second, a little calmer for philosophy or period stories). Each sets the picture style, frame, voice, reading pace and
 * music together, so a video does not end up as a folk tale in photoreal faces with no music.
 */
export const CHANNEL_PRESETS: Array<{ id: string; label: string; hint: string; apply: (settings: ProjectSettings) => ProjectSettings }> = [
  {
    id: "co-tich",
    label: "Truyện cổ tích",
    hint: "Thẻ truyện, tranh hoạt hình, giọng đọc truyện, nhạc nền",
    apply: (s) => ({ ...withLayoutTemplate(s, "story-card"), style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "video-minh-hoa",
    label: "Video minh họa",
    hint: "Ảnh hoạt hình ở giữa, nền mờ, tiêu đề glow và phụ đề lớn",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "story-card"), "cinematic-color"), cardTheme: "blurred", style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true, captionHighlight: false, hookTitle: false, progressBar: true, sceneSfx: true, subtitle: { ...s.subtitle, preset: "focus", position: "bottom", fontColor: "#FFFFFF", outlineColor: "#101010", backgroundOpacity: 0 } }),
  },
  {
    id: "quy-tac-co-nhan",
    label: "Quy tắc cổ nhân",
    hint: "Thẻ truyện nền be, tiêu đề đỏ + trắng, tranh thủy mặc nâu, phụ đề xanh lá chạy theo lời, giọng nam trầm",
    // Measured on the reference short: beige canvas, red kicker + white title, sepia ink pictures, green karaoke captions.
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "story-card"), "thuy-mac-sepia"), cardTheme: "sepia", style: "truyen-cam-hung", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: false,
      // Short-form retention: under a minute, a bar that shows the end is near, a soft tick at each cut, a call to action at the close.
      targetDurationSec: 45, progressBar: true, sceneSfx: true, outroText: "Theo dõi để xem thêm quy tắc cổ nhân" }),
  },
  {
    id: "dao-ly-co-phong",
    label: "Đạo lý cổ phong",
    hint: "Nhân vật chibi cổ trang trên nền giấy kraft, giọng nam trầm, phụ đề nhỏ dưới nhân vật",
    // Đức Trí: median 107 Hz at 3.7 words/s, the closest to the reference short (99 Hz, 3.6 w/s); "triet-ly" measured
    // 145 Hz and read 14% slower.
    apply: (s) => ({ ...withLayoutTemplate(s, "paper-stage"), style: "truyen-cam-hung", voice: "doc-truyen", voiceSpeed: 1 }),
  },
  {
    id: "tien-hiep-chibi",
    label: "Chibi tiên hiệp",
    hint: "Tu tiên, linh thú, mây núi và pháp bảo chuyển động nhẹ",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "chibi-tien-hiep"), style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true }),
  },
  {
    id: "dan-gian-viet-chibi",
    label: "Chibi dân gian Việt",
    hint: "Cổ tích, ca dao, làng quê Việt và nhân vật chibi thân thiện",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "chibi-dan-gian-viet"), style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true }),
  },
  {
    id: "co-trang-hai-chibi",
    label: "Chibi cổ trang hài",
    hint: "Biểu cảm lớn, tình huống cung đình và cú twist cuối cảnh",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "chibi-co-trang-hai"), style: "ke-chuyen", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "huyen-bi-co-phong",
    label: "Chibi huyền bí cổ phong",
    hint: "Hồ ly, miếu cổ, đèn lồng, khói và cú twist huyền bí",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "chibi-huyen-bi"), style: "ke-chuyen", voice: "co-trang", voiceSpeed: 1, autoMusic: true }),
  },
  {
    id: "chua-lanh",
    label: "Triết lý · chữa lành",
    hint: "Tranh màu nước, giọng trầm, nhịp vừa, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "watercolor"), style: "truyen-cam-hung", voice: "triet-ly", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "co-trang",
    label: "Cổ trang · kiếm hiệp",
    hint: "Bối cảnh cổ trang điện ảnh, giọng cổ trang, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "historical"), style: "ke-chuyen", voice: "co-trang", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "tam-su",
    label: "Tâm sự · cảm xúc",
    hint: "Tranh cắt giấy, giọng nữ ấm, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "paper-cut"), style: "truyen-cam-hung", voice: "tam-su", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "kien-thuc",
    label: "Kiến thức · mẹo hay",
    hint: "Ảnh chân thực, giọng thuyết minh nhanh, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "cinematic-color"), style: "kien-thuc", voice: "thuyet-minh", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "ve-tay",
    label: "Giải thích vẽ tay",
    hint: "Bàn tay vẽ từng cảnh trên nền trắng, giọng thuyết minh, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "whiteboard"), style: "kien-thuc", voice: "thuyet-minh", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
];

/** Seconds a script takes to read with this voice (the bridge's pace: 3.7 words/s × the voice's mood × speed). */
export function estimatedNarrationSeconds(wordCount: number, voice: string, voiceSpeed: number): number {
  return Math.round(narrationSeconds(wordCount, voice, voiceSpeed));
}
