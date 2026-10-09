export * from "./schemas";
export * from "./voices";
export * from "./script";
export * from "./regeneration";
export * from "./srt";
export * from "./duration";

import type { VisualPreset } from "./schemas";

export const VISUAL_PRESET_OPTIONS: Array<{ id: VisualPreset; label: string; description: string; prompt: string }> = [
  { id: "cinematic-color", label: "Màu điện ảnh", description: "Ánh sáng tự nhiên, chiều sâu và màu sắc chân thực.", prompt: "cinematic natural illustration, realistic lighting, rich but natural colors, gentle depth of field" },
  { id: "ink-monochrome", label: "Nét mực trắng đen", description: "Vẽ tay đơn giản trên nền giấy, đen và xám mềm.", prompt: "black and white hand-drawn ink illustration, off-white paper texture, strong black contours, soft grey shading, no color" },
  { id: "cartoon", label: "Hoạt hình", description: "Nét viền rõ, hình khối vui tươi, biểu cảm dễ đọc.", prompt: "clean 2D cartoon illustration, bold rounded outlines, expressive characters, simplified shapes, bright friendly colors, consistent character design" },
  { id: "historical", label: "Cổ trang", description: "Bối cảnh lịch sử, trang phục truyền thống và chất liệu điện ảnh.", prompt: "historical period illustration, accurate traditional clothing and architecture, cinematic warm light, detailed fabric and environment, respectful authentic setting" },
  { id: "watercolor", label: "Màu nước", description: "Mảng màu loang nhẹ, mềm và giàu cảm xúc.", prompt: "delicate watercolor illustration, visible paper grain, soft bleeding edges, translucent layered washes, gentle natural palette" },
  { id: "paper-cut", label: "Cắt giấy", description: "Các lớp giấy nổi, bóng đổ nhẹ và bố cục tối giản.", prompt: "layered paper-cut illustration, tactile colored paper shapes, clean silhouettes, subtle cast shadows, handcrafted dimensional composition" },
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
