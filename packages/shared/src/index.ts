export * from "./schemas";
export * from "./voices";
export * from "./script";
export * from "./regeneration";
export * from "./srt";
export * from "./duration";
export * from "./api-keys";
export * from "./nodes";
export * from "./node-settings";

import type { VisualPreset } from "./schemas";

export const VISUAL_PRESET_OPTIONS: Array<{ id: VisualPreset; label: string; description: string; prompt: string }> = [
  { id: "cinematic-color", label: "Màu điện ảnh", description: "Ánh sáng tự nhiên, chiều sâu và màu sắc chân thực.", prompt: "cinematic natural illustration, realistic lighting, rich but natural colors, gentle depth of field" },
  { id: "ink-monochrome", label: "Nét mực trắng đen", description: "Vẽ tay đơn giản trên nền giấy, đen và xám mềm.", prompt: "black and white hand-drawn ink illustration, off-white paper texture, strong black contours, soft grey shading, no color" },
  { id: "cartoon", label: "Hoạt hình", description: "Nét viền rõ, hình khối vui tươi, biểu cảm dễ đọc.", prompt: "clean 2D cartoon illustration, bold rounded outlines, expressive characters, simplified shapes, bright friendly colors, consistent character design" },
  { id: "historical", label: "Cổ trang", description: "Bối cảnh lịch sử, trang phục truyền thống và chất liệu điện ảnh.", prompt: "historical period illustration, accurate traditional clothing and architecture, cinematic warm light, detailed fabric and environment, respectful authentic setting" },
  { id: "watercolor", label: "Màu nước", description: "Mảng màu loang nhẹ, mềm và giàu cảm xúc.", prompt: "delicate watercolor illustration, visible paper grain, soft bleeding edges, translucent layered washes, gentle natural palette" },
  { id: "paper-cut", label: "Cắt giấy", description: "Các lớp giấy nổi, bóng đổ nhẹ và bố cục tối giản.", prompt: "layered paper-cut illustration, tactile colored paper shapes, clean silhouettes, subtle cast shadows, handcrafted dimensional composition" },
  { id: "chibi-co-phong", label: "Chibi cổ phong", description: "Nhân vật chibi áo cổ trang trên nền giấy kraft, màu xanh rêu trầm.", prompt: "cute chibi illustration, plain warm beige kraft paper background, ancient Asian robe in muted olive green, clean ink outlines, centered full body" },
  { id: "chibi-tien-hiep", label: "Chibi tiên hiệp", description: "Chibi tu tiên, linh thú, mây núi và pháp bảo với chuyển động nhẹ.", prompt: "cute chibi xianxia illustration, ancient cultivation robe, small spirit companion, misty mountain clouds and floating talismans, warm parchment background, clean ink outlines, expressive face, animation-ready separated foreground and background" },
  { id: "chibi-dan-gian-viet", label: "Chibi dân gian Việt", description: "Cổ tích, ca dao và làng quê Việt dưới nét chibi thân thiện.", prompt: "cute Vietnamese folk-tale chibi illustration, áo tứ thân or simple traditional Vietnamese clothing, village courtyard, bamboo, lotus and warm handmade paper texture, clean ink outlines, respectful Vietnamese cultural details, animation-ready" },
  { id: "chibi-co-trang-hai", label: "Chibi cổ trang hài", description: "Tình huống cung đình và đời thường vui, biểu cảm lớn, dễ đọc.", prompt: "funny ancient court chibi illustration, expressive exaggerated reaction, traditional robe, palace corridor or market, warm paper texture, clean rounded ink outlines, strong readable pose, animation-ready" },
  { id: "thuy-mac-co-phong", label: "Thủy mặc cổ phong", description: "Nét mực loang, núi mây và đèn lồng với nhịp chuyển động thiền.", prompt: "ancient East Asian ink-wash animation, expressive brush lines, misty mountains, drifting cloud and falling petals, muted black vermilion and parchment palette, cinematic negative space, animation-ready layered composition" },
  { id: "paper-storybook", label: "Truyện giấy chuyển động", description: "Các lớp giấy thủ công nổi, bóng đổ và chuyển động sân khấu.", prompt: "handmade paper storybook stage, layered cut-paper characters and scenery, tactile kraft paper fibers, soft cast shadows, visible depth between layers, gentle stop-motion-like movement, animation-ready" },
  { id: "chibi-huyen-bi", label: "Chibi huyền bí cổ phong", description: "Hồ ly, quỷ sai, miếu cổ và ánh đèn lồng cho đoạn kết bất ngờ.", prompt: "mysterious ancient folklore chibi illustration, fox spirit or ghost messenger, old shrine, lantern glow, drifting smoke and fireflies, dark teal and warm amber paper palette, cute but eerie, animation-ready" },
  { id: "chibi-dong-vat-co-phong", label: "Động vật chibi cổ phong", description: "Mèo, cáo, thỏ hoặc gấu mặc cổ phục, phù hợp xây nhân vật thương hiệu.", prompt: "adorable animal chibi in ancient Vietnamese or East Asian robe, cat fox rabbit or bear character, expressive eyes, small prop, warm kraft paper background, clean ink outlines, animation-ready character pose" },
  { id: "whiteboard", label: "Vẽ tay bảng trắng", description: "Bàn tay vẽ từng nét bút dạ rồi tô màu trên nền trắng.", prompt: "whiteboard doodle illustration, bold black marker outlines, flat pastel colors, plain white background, simple shapes" },
];

/** Whiteboard videos are drawn stroke by stroke by the hand renderer instead of a camera move over the still. */
export function drawsByHand(settings: { visualPreset: VisualPreset }): boolean {
  return settings.visualPreset === "whiteboard";
}

export function visualPresetPrompt(preset: VisualPreset): string {
  return VISUAL_PRESET_OPTIONS.find((item) => item.id === preset)?.prompt ?? VISUAL_PRESET_OPTIONS[0]!.prompt;
}

export const DEFAULT_PROJECT_SETTINGS = {
  textProvider: "anthropic" as const,
  mediaProvider: "local" as const,
  targetAudience: "Người xem Việt Nam",
  style: "ke-chuyen" as const,
  targetDurationSec: 60 as const,
  aspectRatio: "9:16" as const,
  generationPreset: "balanced" as const,
  visualPreset: "cinematic-color" as const,
  voice: "alloy",
  localModels: { storyboard: null, image: null, video: null, tts: null, transcribe: null },
  visualStyle: "Ảnh điện ảnh chân thực, ánh sáng tự nhiên, nhân vật Việt Nam",
  allowUploads: true,
  backgroundMusicPath: null,
  musicVolume: 0.12,
  logoPath: null,
  logoPosition: "top-right" as const,
  logoScale: 0.14,
  logoOpacity: 0.9,
  rewriteFullScript: false,
  layoutTemplate: "full-bleed" as const,
  cardTitle: "",
  brandName: "",
  voiceSpeed: 1,
  autoMusic: false,
  captionHighlight: false,
  hookTitle: false,
  trimSilence: false,
  subtitle: {
    enabled: true,
    preset: "classic" as const,
    position: "bottom" as const,
    fontColor: "#FFFFFF",
    outlineColor: "#101828",
    backgroundColor: "#000000",
    backgroundOpacity: 0.35,
  },
};

export function humanStatus(status: string): string {
  return (
    (
      {
        draft: "Bản nháp",
        generating_media: "Đang tạo media",
        queued: "Chờ render",
        rendering: "Đang render",
        completed: "Hoàn thành",
        failed: "Có lỗi",
      } as Record<string, string>
    )[status] ?? status
  );
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Danh sách model local khả dụng, do cầu nối media trên máy báo về. */
export type LocalModelOption = { id: string; label: string };
export type LocalModelCatalog = {
  available: boolean;
  storyboard: { models: LocalModelOption[]; default: string | null };
  image: { models: LocalModelOption[]; default: string | null };
  video: { models: LocalModelOption[]; default: string | null };
  tts: { models: LocalModelOption[]; default: string | null };
  transcribe: { models: LocalModelOption[]; default: string | null };
};
