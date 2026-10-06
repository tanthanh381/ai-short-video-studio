export * from "./schemas";
export * from "./voices";
export * from "./script";
export * from "./regeneration";

export const DEFAULT_PROJECT_SETTINGS = {
  textProvider: "anthropic" as const,
  mediaProvider: "local" as const,
  targetAudience: "Người xem Việt Nam",
  style: "ke-chuyen" as const,
  targetDurationSec: 60 as const,
  aspectRatio: "9:16" as const,
  generationPreset: "balanced" as const,
  voice: "alloy",
  localModels: { storyboard: null, image: null, video: null, tts: null, transcribe: null },
  visualStyle: "Ảnh điện ảnh chân thực, ánh sáng tự nhiên, nhân vật Việt Nam",
  allowUploads: true,
  backgroundMusicPath: null,
  musicVolume: 0.12,
  rewriteFullScript: false,
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
