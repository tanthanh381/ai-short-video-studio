import { readFile, rm } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { projectSchema, type Project, type Scene } from "@studio/shared";
import { getConfig } from "./config";
import { AnthropicStoryboardAdapter } from "./anthropic";
import { OllamaStoryboardAdapter } from "./ollama";
import { groupWords, OpenAIAdapter } from "./openai";
import type { StoryboardProvider } from "./providers";
import { renderProject } from "./render";

const config = getConfig();
const log = pino({
  level: "info",
  redact: [
    "apiKey",
    "SUPABASE_SECRET_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ],
});
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const openai = config.OPENAI_API_KEY
  ? new OpenAIAdapter(config.OPENAI_API_KEY, {
      text: config.OPENAI_TEXT_MODEL,
      image: config.OPENAI_IMAGE_MODEL,
      tts: config.OPENAI_TTS_MODEL,
    })
  : null;
const anthropic = config.ANTHROPIC_API_KEY
  ? new AnthropicStoryboardAdapter(
      config.ANTHROPIC_API_KEY,
      config.ANTHROPIC_TEXT_MODEL,
    )
  : null;
const ollama = new OllamaStoryboardAdapter(
  config.OLLAMA_BASE_URL,
  config.OLLAMA_MODEL,
);
const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid timestamp from database");
  }
  return parsed.toISOString();
}

type JobRow = {
  id: string;
  project_id: string;
  user_id: string;
  job_type:
    | "storyboard"
    | "generate_media"
    | "regenerate_scene"
    | "render_video";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

async function setProgress(id: string, progress: number, stage: string) {
  await db
    .from("jobs")
    .update({ progress, stage, heartbeat_at: new Date().toISOString() })
    .eq("id", id);
}
async function getProject(id: string): Promise<Project> {
  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const { data: scenes, error: sceneError } = await db
    .from("scenes")
    .select("*")
    .eq("project_id", id)
    .order("scene_order");
  if (sceneError) throw sceneError;
  return projectSchema.parse({
    id: project.id,
    userId: project.user_id,
    title: project.title,
    sourceText: project.source_text,
    inputMode: project.input_mode ?? "idea",
    hook: project.hook ?? "",
    suggestedTitle: project.suggested_title ?? "",
    suggestedDescription: project.suggested_description ?? "",
    status: project.status,
    settings: project.settings,
    scenes: (scenes ?? []).map((s) => ({
      id: s.id,
      order: s.scene_order,
      narration: s.narration,
      imagePrompt: s.image_prompt,
      estimatedDurationMs: s.estimated_duration_ms,
      actualDurationMs: s.actual_duration_ms,
      imagePath: s.image_path,
      audioPath: s.audio_path,
      thumbnailUrl: null,
      mediaStatus: s.media_status,
      errorMessage: s.error_message,
      subtitles: s.subtitles ?? [],
    })),
    createdAt: isoTimestamp(project.created_at),
    updatedAt: isoTimestamp(project.updated_at),
  });
}
async function upload(path: string, data: Uint8Array, contentType: string) {
  const { error } = await db.storage
    .from("private-media")
    .upload(path, data, { contentType, upsert: true, cacheControl: "3600" });
  if (error) throw error;
}
async function download(path: string) {
  const { data, error } = await db.storage.from("private-media").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
async function removePrefix(prefix: string) {
  const bucket = db.storage.from("private-media");
  while (true) {
    const { data, error } = await bucket.list(prefix, {
      limit: 100,
      offset: 0,
    });
    if (error) throw error;
    const paths = (data ?? [])
      .filter((item) => item.id)
      .map((item) => `${prefix}/${item.name}`);
    if (paths.length) {
      const { error: removeError } = await bucket.remove(paths);
      if (removeError) throw removeError;
    }
    if ((data ?? []).length < 100) return;
  }
}

async function storyboard(job: JobRow, project: Project) {
  const providerName = project.settings.textProvider;
  const provider: StoryboardProvider | null =
    providerName === "openai"
      ? openai
      : providerName === "ollama"
        ? ollama
        : anthropic;
  if (!provider) {
    throw new Error(
      providerName === "openai"
        ? "Chưa cấu hình OpenAI cho phần kịch bản"
        : providerName === "ollama"
          ? "Chưa kết nối Ollama hoặc chưa cài model"
          : "Chưa cấu hình Claude cho phần kịch bản",
    );
  }
  await setProgress(job.id, 10, "Đang phân tích nội dung");
  const result = await provider.createStoryboard({
    title: project.title,
    sourceText: project.sourceText,
    inputMode: project.inputMode,
    rewrite: project.settings.rewriteFullScript,
    audience: project.settings.targetAudience,
    style: project.settings.style,
    duration: project.settings.targetDurationSec,
    visualStyle: project.settings.visualStyle,
  });
  await setProgress(job.id, 70, "Đang lưu storyboard");
  await removePrefix(`${project.userId}/${project.id}/generated`);
  await db.from("scenes").delete().eq("project_id", project.id);
  const rows = result.scenes.map((scene, index) => ({
    project_id: project.id,
    scene_order: index,
    narration: scene.narration,
    image_prompt: scene.imagePrompt,
    estimated_duration_ms: scene.estimatedDurationMs,
    media_status: "pending",
    subtitles: [],
  }));
  if (rows.length) {
    const { error } = await db.from("scenes").insert(rows);
    if (error) throw error;
  }
  await db
    .from("projects")
    .update({
      hook: result.hook,
      suggested_title: result.suggestedTitle,
      suggested_description: result.suggestedDescription,
      status: "draft",
    })
    .eq("id", project.id);
}

async function generateMedia(job: JobRow, project: Project) {
  if (!openai)
    throw new Error(
      "Chưa cấu hình OpenAI để tạo ảnh, giọng đọc và đồng bộ phụ đề",
    );
  const targetId =
    job.job_type === "regenerate_scene"
      ? String(job.payload.sceneId ?? "")
      : null;
  const scenes = targetId
    ? project.scenes.filter((scene) => scene.id === targetId)
    : project.scenes;
  if (!scenes.length)
    throw new Error(
      targetId ? "Không tìm thấy cảnh cần tạo lại" : "Dự án chưa có cảnh",
    );
  await db
    .from("projects")
    .update({ status: "generating_media" })
    .eq("id", project.id);
  let finished = 0;
  for (const scene of scenes) {
    try {
      await db
        .from("scenes")
        .update({ media_status: "processing", error_message: null })
        .eq("id", scene.id);
      const forceRegenerate = Boolean(targetId) && job.attempts === 1;
      let imagePath = forceRegenerate ? null : scene.imagePath;
      let audioPath = forceRegenerate ? null : scene.audioPath;
      let audio: Uint8Array;
      if (!imagePath) {
        await setProgress(
          job.id,
          Math.round((finished / scenes.length) * 85),
          `Đang tạo ảnh cảnh ${scene.order + 1}`,
        );
        const image = await openai.createImage(
          `${scene.imagePrompt}. Không chữ, không logo, không watermark.`,
          project.settings.aspectRatio,
        );
        imagePath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.png`;
        await upload(imagePath, image, "image/png");
        await db
          .from("scenes")
          .update({ image_path: imagePath })
          .eq("id", scene.id);
        if (
          forceRegenerate &&
          scene.imagePath?.startsWith(
            `${project.userId}/${project.id}/generated/`,
          )
        )
          await db.storage.from("private-media").remove([scene.imagePath]);
      }
      if (!audioPath) {
        await setProgress(
          job.id,
          Math.round((finished / scenes.length) * 85) + 4,
          `Đang tạo giọng đọc cảnh ${scene.order + 1}`,
        );
        audio = await openai.createSpeech(
          scene.narration,
          project.settings.voice,
        );
        audioPath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.mp3`;
        await upload(audioPath, audio, "audio/mpeg");
        await db
          .from("scenes")
          .update({ audio_path: audioPath })
          .eq("id", scene.id);
        if (
          forceRegenerate &&
          scene.audioPath?.startsWith(
            `${project.userId}/${project.id}/generated/`,
          )
        )
          await db.storage.from("private-media").remove([scene.audioPath]);
      } else {
        audio = await download(audioPath);
      }
      await setProgress(
        job.id,
        Math.round((finished / scenes.length) * 85) + 7,
        `Đang đồng bộ phụ đề cảnh ${scene.order + 1}`,
      );
      const words = await openai.transcribe(audio);
      const subtitles = groupWords(words);
      const actualDurationMs = Math.max(
        ...subtitles.map((c) => c.endMs),
        scene.estimatedDurationMs,
      );
      await db
        .from("scenes")
        .update({
          image_path: imagePath,
          audio_path: audioPath,
          subtitles,
          actual_duration_ms: actualDurationMs,
          media_status: "ready",
          error_message: null,
        })
        .eq("id", scene.id);
      if (targetId) {
        const generatedPrefix = `${project.userId}/${project.id}/generated/`;
        const replacedPaths = [scene.imagePath, scene.audioPath].filter(
          (path): path is string =>
            Boolean(path) &&
            path!.startsWith(generatedPrefix) &&
            path !== imagePath &&
            path !== audioPath,
        );
        if (replacedPaths.length) {
          const { error: cleanupError } = await db.storage
            .from("private-media")
            .remove(replacedPaths);
          if (cleanupError)
            log.warn(
              { jobId: job.id, sceneId: scene.id },
              "old_scene_media_cleanup_failed",
            );
        }
      }
      finished++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể tạo media";
      await db
        .from("scenes")
        .update({
          media_status: "failed",
          error_message: message.slice(0, 500),
        })
        .eq("id", scene.id);
      log.error(
        { jobId: job.id, sceneId: scene.id, err: message },
        "scene_media_failed",
      );
    }
  }
  if (finished === 0) throw new Error("Tất cả các cảnh đều tạo media lỗi");
  await db
    .from("projects")
    .update({ status: finished === scenes.length ? "draft" : "failed" })
    .eq("id", project.id);
  await db.from("usage_events").insert({
    user_id: project.userId,
    project_id: project.id,
    job_id: job.id,
    kind: "ai_media_estimate",
    amount_usd: Number((finished * 0.06).toFixed(2)),
    metadata: { successful_scenes: finished, total_scenes: scenes.length },
  });
  if (finished < scenes.length)
    throw new Error(
      `${scenes.length - finished} cảnh tạo media lỗi; các cảnh thành công đã được giữ lại`,
    );
}

async function render(job: JobRow, project: Project) {
  await db
    .from("projects")
    .update({ status: "rendering" })
    .eq("id", project.id);
  const result = await renderProject(
    config,
    project,
    download,
    (value, stage) => setProgress(job.id, value, stage),
  );
  try {
    const outputPath = `${project.userId}/${project.id}/exports/${job.id}.mp4`;
    const thumbnailPath = `${project.userId}/${project.id}/exports/${job.id}.jpg`;
    await upload(
      outputPath,
      new Uint8Array(await readFile(result.output)),
      "video/mp4",
    );
    await upload(
      thumbnailPath,
      new Uint8Array(await readFile(result.thumbnail)),
      "image/jpeg",
    );
    await db.from("exports").upsert(
      {
        project_id: project.id,
        job_id: job.id,
        storage_path: outputPath,
        thumbnail_path: thumbnailPath,
        duration_ms: result.durationMs,
        width: project.settings.aspectRatio === "16:9" ? 1920 : 1080,
        height: project.settings.aspectRatio === "9:16" ? 1920 : 1080,
        status: "completed",
      },
      { onConflict: "job_id" },
    );
    for (const scene of project.scenes)
      await db
        .from("scenes")
        .update({ actual_duration_ms: scene.actualDurationMs })
        .eq("id", scene.id);
    await db
      .from("projects")
      .update({ status: "completed" })
      .eq("id", project.id);
  } finally {
    await rm(result.workdir, { recursive: true, force: true });
  }
}

async function run(job: JobRow) {
  const project = await getProject(job.project_id);
  if (job.job_type === "storyboard") await storyboard(job, project);
  else if (
    job.job_type === "generate_media" ||
    job.job_type === "regenerate_scene"
  )
    await generateMedia(job, project);
  else if (job.job_type === "render_video") await render(job, project);
}
async function finish(job: JobRow, error?: unknown) {
  if (!error) {
    await db
      .from("jobs")
      .update({
        status: "completed",
        progress: 100,
        stage: "Hoàn thành",
        finished_at: new Date().toISOString(),
        locked_by: null,
        locked_at: null,
      })
      .eq("id", job.id);
    return;
  }
  const message = error instanceof Error ? error.message : "Tác vụ gặp lỗi";
  const retry = job.attempts < job.max_attempts;
  const delaySeconds = Math.min(60, Math.pow(2, job.attempts) * 5);
  await db
    .from("jobs")
    .update({
      status: retry ? "queued" : "failed",
      progress: retry ? 0 : 99,
      stage: retry ? `Sẽ thử lại sau ${delaySeconds} giây` : "Tác vụ thất bại",
      error_message: message.slice(0, 800),
      next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      locked_by: null,
      locked_at: null,
      finished_at: retry ? null : new Date().toISOString(),
    })
    .eq("id", job.id);
  if (!retry)
    await db
      .from("projects")
      .update({ status: "failed" })
      .eq("id", job.project_id);
  log.error({ jobId: job.id, err: message, retry }, "job_failed");
}

async function poll() {
  const { data, error } = await db.rpc("claim_next_job", {
    p_worker_id: workerId,
  });
  if (error) {
    log.error({ err: error.message }, "claim_failed");
    return;
  }
  const job = Array.isArray(data)
    ? (data[0] as JobRow | undefined)
    : (data as JobRow | null);
  if (!job) return;
  log.info({ jobId: job.id, type: job.job_type }, "job_started");
  try {
    await run(job);
    await finish(job);
    log.info({ jobId: job.id }, "job_completed");
  } catch (error) {
    await finish(job, error);
  }
}

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
log.info(
  {
    workerId,
    providers: {
      anthropicStoryboard: Boolean(anthropic),
      openaiStoryboardAndMedia: Boolean(openai),
      ollamaStoryboard: true,
    },
  },
  "worker_started",
);
while (!stopping) {
  await poll();
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}
log.info("worker_stopped");
