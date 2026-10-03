import {
  projectSchema,
  jobSchema,
  type Job,
  type Project,
  type Scene,
} from "@studio/shared";

type Row = Record<string, unknown>;

export function mapScene(row: Row): Scene {
  return {
    id: String(row.id),
    order: Number(row.scene_order),
    narration: String(row.narration),
    imagePrompt: String(row.image_prompt),
    estimatedDurationMs: Number(row.estimated_duration_ms),
    actualDurationMs:
      row.actual_duration_ms == null ? null : Number(row.actual_duration_ms),
    imagePath: row.image_path == null ? null : String(row.image_path),
    audioPath: row.audio_path == null ? null : String(row.audio_path),
    thumbnailUrl: null,
    mediaStatus: row.media_status as Scene["mediaStatus"],
    errorMessage: row.error_message == null ? null : String(row.error_message),
    subtitles: Array.isArray(row.subtitles)
      ? (row.subtitles as Scene["subtitles"])
      : [],
  };
}

export function mapProject(row: Row, sceneRows: Row[] = []): Project {
  return projectSchema.parse({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    sourceText: row.source_text,
    inputMode: row.input_mode ?? "idea",
    hook: row.hook ?? "",
    suggestedTitle: row.suggested_title ?? "",
    suggestedDescription: row.suggested_description ?? "",
    status: row.status,
    settings: row.settings,
    scenes: sceneRows.map(mapScene).sort((a, b) => a.order - b.order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function mapJob(row: Row): Job {
  return jobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    type: row.job_type,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    errorMessage: row.error_message,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
