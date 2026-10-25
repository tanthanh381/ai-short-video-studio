export type PublishReadinessInput = {
  completed: boolean;
  hasResult: boolean;
  width?: number | null;
  height?: number | null;
  aspectRatio: string;
  contentScore?: number | null;
  /** Editorial hook score on a 0–100 scale; 80 is the publish minimum (8/10). */
  hookScore?: number | null;
  subtitlesEnabled: boolean;
  scenes: Array<{
    imagePath?: string | null;
    audioPath?: string | null;
    subtitles?: unknown[] | null;
    errorMessage?: string | null;
  }>;
};

export type PublishReadiness = { ready: boolean; blockers: string[] };

/** Distinguishes a technically exported MP4 from a file that passed the creator-facing release checks. */
export function evaluatePublishReadiness(input: PublishReadinessInput): PublishReadiness {
  const blockers: string[] = [];
  if (!input.hasResult || !input.completed) blockers.push("Video chưa render hoàn tất");
  if (!input.scenes.length) blockers.push("Chưa có scene");
  if (input.contentScore !== null && input.contentScore !== undefined && input.contentScore < 80)
    blockers.push("Content check dưới 80/100");
  if (input.hookScore !== null && input.hookScore !== undefined && input.hookScore < 80)
    blockers.push("Hook 3 giây đầu dưới 8/10");
  if (input.scenes.some((scene) => scene.errorMessage)) blockers.push("Có scene cần xử lý lại");
  if (input.scenes.some((scene) => !scene.imagePath || !scene.audioPath)) blockers.push("Thiếu ảnh hoặc giọng đọc");
  if (input.subtitlesEnabled && input.scenes.some((scene) => !scene.subtitles?.length)) blockers.push("Thiếu phụ đề ở một hoặc nhiều scene");
  if (input.width && input.height) {
    const expected = input.aspectRatio === "1:1" ? 1 : input.aspectRatio === "16:9" ? 16 / 9 : 9 / 16;
    if (Math.abs(input.width / input.height - expected) > 0.02) blockers.push("Tỷ lệ khung hình không khớp");
  }
  return { ready: blockers.length === 0, blockers };
}
