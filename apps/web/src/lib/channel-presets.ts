import { narrationSeconds, type ProjectSettings } from "@studio/shared";
import { withLayoutTemplate, withVisualPreset } from "./visual-preset";

/**
 * One-click looks for common faceless channel niches. Reading speed stays 1.0: the voice bridge already brings
 * every voice to the short-form pace (about 3.7 words per second, a little calmer for philosophy or period stories). Each sets the picture style, frame, voice, reading pace and
 * music together, so a video does not end up as a folk tale in photoreal faces with no music.
 */
export const CHANNEL_PRESETS: Array<{ id: string; label: string; hint: string; apply: (settings: ProjectSettings) => ProjectSettings }> = [
  {
    id: "dao-ly-co-phong",
    label: "Chibi cổ trang",
    hint: "Nhân vật chibi cổ trang trên nền giấy kraft, giọng nam trầm, phụ đề nhỏ dưới nhân vật",
    // Đức Trí: median 107 Hz at 3.7 words/s, the closest to the reference short (99 Hz, 3.6 w/s); "triet-ly" measured
    // 145 Hz and read 14% slower.
    // Motion stays OFF (still frame + gentle paper-stage breathing): free local image→video (LTX/MLX) morphs the
    // hand-drawn art on this hardware, so a clean still beats it. Real character motion needs cloud I2V — enable that
    // per-project via the motion-model picker when a cloud video provider is wired.
    apply: (s) => ({ ...withLayoutTemplate(s, "paper-stage"), localModels: { ...s.localModels, video: null }, style: "truyen-cam-hung", voice: "doc-truyen", voiceSpeed: 1, targetDurationSec: 30, autoMusic: true, captionHighlight: false, hookTitle: false, progressBar: false, sceneSfx: false, outroText: "" }),
  },
  {
    id: "ve-tay",
    label: "Giải thích vẽ tay",
    hint: "Bàn tay vẽ từng cảnh trên nền trắng, giọng thuyết minh, nhạc nền",
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "full-bleed"), "whiteboard"), style: "kien-thuc", voice: "thuyet-minh", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: true }),
  },
  {
    id: "quy-tac-co-nhan",
    label: "Quy tắc cổ nhân",
    hint: "Thẻ truyện nền be, tranh thủy mặc nâu, phụ đề chạy theo lời, giọng nam trầm",
    // Beige canvas, red kicker + white title, sepia ink pictures and green karaoke captions.
    apply: (s) => ({ ...withVisualPreset(withLayoutTemplate(s, "story-card"), "thuy-mac-sepia"), cardTheme: "sepia", style: "truyen-cam-hung", voice: "doc-truyen", voiceSpeed: 1, autoMusic: true, captionHighlight: true, hookTitle: false,
      targetDurationSec: 45, progressBar: true, sceneSfx: true, outroText: "Theo dõi để xem thêm quy tắc cổ nhân" }),
  },
];

/** Seconds a script takes to read with this voice (the bridge's pace: 3.7 words/s × the voice's mood × speed). */
export function estimatedNarrationSeconds(wordCount: number, voice: string, voiceSpeed: number): number {
  return Math.round(narrationSeconds(wordCount, voice, voiceSpeed));
}
