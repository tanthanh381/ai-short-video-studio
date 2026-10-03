export * from "./schemas";

export const DEFAULT_PROJECT_SETTINGS = {
  textProvider: "anthropic" as const,
  targetAudience: "Người xem Việt Nam",
  style: "ke-chuyen" as const,
  targetDurationSec: 60 as const,
  aspectRatio: "9:16" as const,
  voice: "alloy",
  visualStyle: "Minh họa điện ảnh, ấm áp, gần gũi",
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
