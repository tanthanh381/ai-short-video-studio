import { regenerationComponentSchema, type Scene } from "@studio/shared";
export type RegenerationCheckpoint = { imagePath: string | null; audioPath: string | null; subtitlesCompleted?: boolean };
/** Keep successful assets on retry; voice replacement invalidates dependent captions. */
export function regenerationPlan(scene: Scene, requested: unknown, previous: RegenerationCheckpoint, subtitlesEnabled: boolean) {
  const component = regenerationComponentSchema.parse(requested);
  if (component === "image" && (!scene.audioPath || !scene.actualDurationMs || (subtitlesEnabled && !scene.subtitles.length)))
    throw new Error("Cần có giọng đọc và phụ đề trước khi chỉ tạo lại ảnh. Hãy hoàn tất media còn thiếu trước.");
  if ((component === "audio" || component === "subtitles") && !scene.imagePath)
    throw new Error("Cần có ảnh trước khi chỉ sửa giọng đọc hoặc phụ đề.");
  if (component === "subtitles" && (!scene.audioPath || !subtitlesEnabled))
    throw new Error("Cần có audio và bật phụ đề trước khi đồng bộ lại phụ đề.");
  return {
    image: (component === "all" || component === "image") && scene.imagePath === previous.imagePath,
    audio: (component === "all" || component === "audio") && scene.audioPath === previous.audioPath,
    subtitles: component === "subtitles" && !previous.subtitlesCompleted,
  };
}
