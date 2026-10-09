import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { parseSrt, projectSchema, type Project, type Scene, visualPresetPrompt } from "@studio/shared";
import { getConfig } from "./config";
import { AnthropicStoryboardAdapter } from "./anthropic";
import { OllamaStoryboardAdapter } from "./ollama";
import { LocalMediaAdapter } from "./local-media";
import { groupWords, OpenAIAdapter } from "./openai";
import { castForScript, fallbackCardTitle, usesStoryCard } from "./card-layout";
import { cleanHashtags, fallbackPostCaption, formatPostCaption } from "./post-caption";
import { alignKnownText, buildProductionImagePrompt, cleanScriptForNarration, createFaithfulStoryboard, eraAppropriateCast, imageAspectFor, imageSeedFor, imageStyleFor, withCast, type MediaProvider, type StoryboardProvider } from "./providers";
import { runVideoPipeline, sceneMediaReady } from "./pipeline";
import { renderProject } from "./render";
import { regenerationPlan, type RegenerationCheckpoint } from "./regeneration";
import { renderWhiteboardVideo } from "./whiteboard";

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
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }) },
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
  { numCtx: config.OLLAMA_NUM_CTX, keepAlive: config.OLLAMA_KEEP_ALIVE },
);
const localMedia = new LocalMediaAdapter(config.LOCAL_MEDIA_BASE_URL);
const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

type HealthState = "healthy" | "configured" | "offline";
type HealthItem = { state: HealthState; detail: string };

async function probeJson(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function probeRender(): Promise<boolean> {
  try {
    const { stdout } = await exec(config.FFMPEG_PATH, ["-hide_banner", "-filters"], {
      timeout: 5_000,
      maxBuffer: 2_000_000,
    });
    // The default product path burns Vietnamese ASS subtitles into every
    // export, so an FFmpeg binary without libass is not render-ready.
    return /\bsubtitles\b/.test(stdout);
  } catch {
    return false;
  }
}

async function workerHealth() {
  const [ollamaReady, mediaReady, renderReady] = await Promise.all([
    probeJson(`${config.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`),
    probeJson(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/models`),
    probeRender(),
  ]);
  const configured = (available: boolean, ready: boolean, name: string): HealthItem => ({
    state: available ? (ready ? "healthy" : "offline") : "offline",
    detail: available
      ? ready ? `${name} đang phản hồi` : `${name} chưa phản hồi`
      : `Chưa cấu hình ${name}`,
  });
  return {
    ok: true,
    workerId,
    checkedAt: new Date().toISOString(),
    services: {
      worker: { state: "healthy" as const, detail: "Worker đang chạy và sẵn sàng nhận job" },
      render: {
        state: renderReady ? "healthy" as const : "offline" as const,
        detail: renderReady
          ? "FFmpeg và bộ lọc phụ đề đã sẵn sàng"
          : "FFmpeg thiếu bộ lọc subtitles/libass; chưa thể render phụ đề",
      },
      openai: { state: openai ? "configured" as const : "offline" as const, detail: openai ? "Đã có API key; chưa gọi thử để tránh phát sinh phí" : "Chưa có API key" },
      anthropic: { state: anthropic ? "configured" as const : "offline" as const, detail: anthropic ? "Đã có API key; chưa gọi thử để tránh phát sinh phí" : "Chưa có API key" },
      ollama: configured(true, ollamaReady, "Ollama"),
      localMedia: configured(true, mediaReady, "Media local"),
    } satisfies Record<string, HealthItem>,
  };
}

const healthServer = createServer(async (request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const payload = await workerHealth();
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
});
healthServer.listen(config.WORKER_HEALTH_PORT, config.WORKER_HEALTH_HOST, () => {
  log.info({ port: config.WORKER_HEALTH_PORT }, "worker_health_started");
});

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
    | "create_video"
    | "storyboard"
    | "generate_media"
    | "regenerate_scene"
    | "render_video"
    | "dub_video"
    | "render_whiteboard";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  deadline?: number;
};

async function setProgress(id: string, progress: number, stage: string) {
  const { error } = await db
    .from("jobs")
    .update({ progress, stage, heartbeat_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function updateProject(id: string, values: Record<string, unknown>) {
  const { error } = await db.from("projects").update(values).eq("id", id);
  if (error) throw error;
}

async function updateScene(id: string, values: Record<string, unknown>) {
  const { error } = await db.from("scenes").update(values).eq("id", id);
  if (error) throw error;
}

function checkDeadline(job: JobRow) {
  if (job.deadline && Date.now() > job.deadline)
    throw new Error("Tác vụ vượt thời gian xử lý cho phép. Các cảnh đã hoàn thành được giữ lại; hãy bấm Tiếp tục.");
}

async function progress(job: JobRow, value: number, stage: string) {
  checkDeadline(job);
  const mapped = job.job_type === "create_video"
    ? Math.min(74, Math.round(20 + value * 0.54))
    : value;
  await setProgress(job.id, mapped, stage);
}

const exec = promisify(execFile);
async function trimAudioSilence(audio: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "studio-trim-"));
  try {
    const inPath = join(dir, "in.mp3");
    const outPath = join(dir, "out.mp3");
    await writeFile(inPath, audio);
    await exec(
      config.FFMPEG_PATH,
      [
        "-y", "-i", inPath,
        "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_duration=0.05:stop_periods=1:stop_threshold=-50dB:stop_duration=0.3",
        "-c:a", "libmp3lame", "-q:a", "2",
        outPath,
      ],
      { timeout: 30_000 },
    );
    return new Uint8Array(await readFile(outPath));
  } catch {
    return audio;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function probeAudioDuration(audio: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "studio-probe-"));
  try {
    const path = join(directory, "audio");
    await writeFile(path, audio);
    const { stdout } = await exec(config.FFPROBE_PATH, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { timeout: 30_000 });
    const result = Math.round(Number(stdout.trim()) * 1000);
    if (!Number.isFinite(result) || result < 100 || result > 180_000)
      throw new Error("Thời lượng audio cảnh không hợp lệ");
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
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
      videoPath: s.video_path ?? null,
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
  if (project.inputMode === "srt") {
    const entries = parseSrt(project.sourceText);
    if (!entries.length)
      throw new Error("File SRT không có nội dung hợp lệ. Hãy kiểm tra định dạng file.");
    await setProgress(job.id, 10, "Đang tạo cảnh từ file SRT");
    const rows = entries.map((e, i) => ({
      project_id: project.id,
      scene_order: i,
      narration: e.text,
      image_prompt: e.text,
      estimated_duration_ms: e.endMs - e.startMs,
      media_status: "pending",
      subtitles: [{ id: crypto.randomUUID(), startMs: 0, endMs: e.endMs - e.startMs, text: e.text }],
    }));
    const { error: saveError } = await db.rpc("replace_storyboard", {
      p_project_id: project.id, p_user_id: project.userId, p_scenes: rows,
      p_hook: "", p_suggested_title: project.title,
      p_suggested_description: "",
      p_status: job.job_type === "create_video" ? "queued" : "draft",
    });
    if (saveError) throw saveError;
    return;
  }
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
  await setProgress(job.id, job.job_type === "create_video" ? 3 : 10, "Đang phân tích nội dung");
  const sourceText = cleanScriptForNarration(project.sourceText);
  const storyboardInput = {
    title: project.title,
    sourceText,
    inputMode: project.inputMode,
    rewrite: project.settings.rewriteFullScript,
    audience: project.settings.targetAudience,
    style: project.settings.style,
    duration: project.settings.targetDurationSec,
    visualStyle: `${project.settings.visualStyle}; ${visualPresetPrompt(project.settings.visualPreset)}`,
    model: project.settings.localModels.storyboard,
  } as const;
  const cardMode = usesStoryCard(project.settings);
  const describeCast = () => provider.describeCast
    ? provider.describeCast({ title: project.title, sourceText, model: project.settings.localModels.storyboard, cartoon: cardMode })
    : Promise.resolve("");
  let cast = "";
  let result;
  if (cardMode) {
    // The prompt writer must know the family up front so every scene shows the same two characters.
    cast = castForScript(sourceText) || await describeCast();
    result = await createFaithfulStoryboard(provider, { ...storyboardInput, cast });
  } else {
    // Cast extraction is independent of scene splitting; overlap the two Ollama
    // requests so the consistency guard does not add a full model round-trip.
    // Fixed role looks (mother in red, two brothers…) keep people recognisable better than a model-written cast.
    const scriptCast = castForScript(sourceText);
    [result, cast] = await Promise.all([createFaithfulStoryboard(provider, storyboardInput), scriptCast ? Promise.resolve(scriptCast) : describeCast()]);
  }
  cast = eraAppropriateCast(cast, sourceText);
  checkDeadline(job);
  // Story-card banner: one short promise-style title, written once and stored with the project.
  let suggestedTitle = result.suggestedTitle;
  if (project.settings.layoutTemplate === "story-card" && !project.settings.cardTitle.trim()) {
    const script = cleanScriptForNarration(project.sourceText);
    suggestedTitle = (provider.writeCardTitle
      ? await provider.writeCardTitle({ sourceText: script, model: project.settings.localModels.storyboard })
      : "") || fallbackCardTitle(script);
  }
  // Post-ready caption (title, one or two sentences, hashtags) instead of the raw script.
  const script = cleanScriptForNarration(project.sourceText);
  const post = (provider.writePostCaption
    ? await provider.writePostCaption({ sourceText: script, title: project.title, model: project.settings.localModels.storyboard }).catch(() => null)
    : null) ?? fallbackPostCaption(script, project.title, project.settings.style);
  const caption = { ...post, hashtags: cleanHashtags(post.hashtags, project.settings.style) };
  if (project.settings.layoutTemplate !== "story-card") suggestedTitle = caption.title || suggestedTitle;
  if (providerName === "ollama") await ollama.unload(project.settings.localModels.storyboard);
  await setProgress(job.id, job.job_type === "create_video" ? 18 : 70, "Đang lưu storyboard");
  const rows = result.scenes.map((scene, index) => ({
    project_id: project.id,
    scene_order: index,
    narration: scene.narration,
    image_prompt: withCast(cast, scene.imagePrompt, scene.narration, cardMode),
    estimated_duration_ms: scene.estimatedDurationMs,
    media_status: "pending",
    subtitles: [],
  }));
  const { error: saveError } = await db.rpc("replace_storyboard", {
    p_project_id: project.id, p_user_id: project.userId, p_scenes: rows,
    p_hook: result.hook, p_suggested_title: suggestedTitle,
    p_suggested_description: formatPostCaption(caption),
    p_status: job.job_type === "create_video" ? "queued" : "draft",
  });
  if (saveError) throw saveError;
  try { await removePrefix(`${project.userId}/${project.id}/generated`); }
  catch { log.warn({ projectId: project.id, jobId: job.id }, "unused_media_cleanup_failed"); }
}

async function generateMedia(job: JobRow, project: Project) {
  const media: MediaProvider | null = project.settings.mediaProvider === "openai" ? openai : localMedia;
  if (!media)
    throw new Error(
      "Chưa cấu hình nhà cung cấp để tạo ảnh, giọng đọc và đồng bộ phụ đề",
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
  await updateProject(project.id, { status: "generating_media" });
  let finished = 0;
  let newlyGenerated = 0;
  // Generate every missing image first, then voices. Alternating the image and voice models scene by scene
  // makes them evict each other from RAM on a 16 GB Mac (minutes of swapping); one pass per model keeps each hot.
  const pendingImages = targetId ? [] : scenes.filter((scene) => !scene.imagePath);
  const prepass = pendingImages.length > 0;
  const mediaProgress = (done: number) => prepass
    ? 42 + Math.round((done / scenes.length) * 43)
    : Math.round((done / scenes.length) * 85);
  for (const [index, scene] of pendingImages.entries()) {
    checkDeadline(job);
    try {
      await updateScene(scene.id, { media_status: "processing", error_message: null });
      await progress(job, Math.round((index / pendingImages.length) * 42), `Đang tạo ảnh cảnh ${scene.order + 1}`);
      const image = await media.createImage(
        buildProductionImagePrompt(scene.imagePrompt, visualPresetPrompt(project.settings.visualPreset)),
        imageAspectFor(project.settings),
        {
          ...project.settings.localModels,
          seed: imageSeedFor(`${project.id}:${scene.id}`),
          style: imageStyleFor(project.settings.visualStyle, project.settings.visualPreset),
          preset: project.settings.generationPreset,
        },
      );
      const imagePath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.png`;
      await upload(imagePath, image, "image/png");
      await updateScene(scene.id, { image_path: imagePath });
      (scene as { imagePath: string | null }).imagePath = imagePath;
    } catch (error) {
      // Not fatal: the per-scene pass below retries this image once more and records a clear failure.
      log.warn({ jobId: job.id, sceneId: scene.id, err: error instanceof Error ? error.message : String(error) }, "image_prepass_failed");
    }
  }
  for (const scene of scenes) {
    checkDeadline(job);
    try {
      if (targetId && !job.payload.regeneration) {
        job.payload = { ...job.payload, regeneration: { imagePath: scene.imagePath, videoPath: scene.videoPath, audioPath: scene.audioPath } };
        const { error: checkpointError } = await db.from("jobs").update({ payload: job.payload }).eq("id", job.id);
        if (checkpointError) throw checkpointError;
      }
      const previous = job.payload.regeneration as RegenerationCheckpoint | undefined;
      const plan = targetId
        ? regenerationPlan(scene, job.payload.component, previous!, project.settings.subtitle.enabled)
        : { image: false, audio: false, subtitles: false };
      const regenerateImage = plan.image;
      const regenerateAudio = plan.audio;
      if (!regenerateImage && !regenerateAudio && !plan.subtitles &&
        (!project.settings.localModels.video || Boolean(scene.videoPath)) &&
        sceneMediaReady(scene, project.settings.subtitle.enabled)) {
        finished++;
        await progress(job, Math.round((finished / scenes.length) * 100), `Đã giữ media cảnh ${scene.order + 1}`);
        continue;
      }
      await updateScene(scene.id, { media_status: "processing", error_message: null });
      let imagePath = regenerateImage ? null : scene.imagePath;
      let videoPath = regenerateImage ? null : scene.videoPath;
      let audioPath = regenerateAudio ? null : scene.audioPath;
      let audio: Uint8Array;
      let subtitles = regenerateAudio || plan.subtitles ? [] : scene.subtitles;
      let actualDurationMs = regenerateAudio ? null : scene.actualDurationMs;
      if (!imagePath) {
        await progress(
          job,
          mediaProgress(finished),
          `Đang tạo ảnh cảnh ${scene.order + 1}`,
        );
        const image = await media.createImage(
          buildProductionImagePrompt(
            scene.imagePrompt,
            visualPresetPrompt(project.settings.visualPreset),
          ),
          imageAspectFor(project.settings),
          {
            ...project.settings.localModels,
            seed: imageSeedFor(`${project.id}:${scene.id}`),
            style: imageStyleFor(project.settings.visualStyle, project.settings.visualPreset),
            preset: project.settings.generationPreset,
          },
        );
        imagePath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.png`;
        await upload(imagePath, image, "image/png");
        await updateScene(scene.id, { image_path: imagePath });
      }
      if (!videoPath && project.settings.localModels.video && media.createVideo) {
        await progress(
          job,
          mediaProgress(finished) + 2,
          `Đang tạo chuyển động LTX cảnh ${scene.order + 1}`,
        );
        const motion = await media.createVideo(
          {
            image: await download(imagePath),
            prompt: `${scene.imagePrompt}. Natural subtle motion, stable face and identity, physically correct hands, consistent clothing, no flicker, no morphing, no extra limbs.`,
            aspectRatio: project.settings.aspectRatio,
          },
          {
            ...project.settings.localModels,
            seed: imageSeedFor(project.id),
            preset: project.settings.generationPreset,
          },
        );
        videoPath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.mp4`;
        await upload(videoPath, motion, "video/mp4");
        await updateScene(scene.id, { video_path: videoPath });
      }
      if (!audioPath) {
        await progress(
          job,
          mediaProgress(finished) + 4,
          `Đang tạo giọng đọc cảnh ${scene.order + 1}`,
        );
        const aligned = media.createSpeechAligned
          ? await media.createSpeechAligned(scene.narration, project.settings.voice, { ...project.settings.localModels, speed: project.settings.voiceSpeed })
          : null;
        audio = aligned?.audio ?? await media.createSpeech(scene.narration, project.settings.voice, { ...project.settings.localModels, speed: project.settings.voiceSpeed });
        subtitles = aligned?.cues ?? [];
        if (project.settings.trimSilence) {
          audio = await trimAudioSilence(audio);
          subtitles = [];
        }
        actualDurationMs = aligned?.durationMs ?? await probeAudioDuration(audio);
        const extension = aligned?.contentType === "audio/wav" ? "wav" : "mp3";
        audioPath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.${extension}`;
        await upload(audioPath, audio, aligned?.contentType ?? "audio/mpeg");
        // Save measured timing together with audio so retries do not transcribe
        // already aligned speech or regenerate a successful scene.
        await updateScene(scene.id, { audio_path: audioPath, subtitles, actual_duration_ms: actualDurationMs });
      } else {
        audio = await download(audioPath);
        actualDurationMs = await probeAudioDuration(audio);
      }
      await progress(
        job,
        mediaProgress(finished) + 7,
        `Đang đồng bộ phụ đề cảnh ${scene.order + 1}`,
      );
      if (!subtitles.length && project.settings.subtitle.enabled) {
        const words = await media.transcribe(audio, project.settings.localModels);
        subtitles = groupWords(alignKnownText(scene.narration, words));
      }
      checkDeadline(job);
      await updateScene(scene.id, {
          image_path: imagePath,
          video_path: videoPath,
          audio_path: audioPath,
          subtitles,
          actual_duration_ms: actualDurationMs,
          media_status: "ready",
          error_message: null,
        });
      if (targetId) {
        if (plan.subtitles) {
          job.payload = { ...job.payload, regeneration: { ...previous, subtitlesCompleted: true } };
          const { error: checkpointError } = await db.from("jobs").update({ payload: job.payload }).eq("id", job.id);
          if (checkpointError) throw checkpointError;
        }
        const generatedPrefix = `${project.userId}/${project.id}/generated/`;
        const replacedPaths = [previous?.imagePath, previous?.videoPath, previous?.audioPath].filter(
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
      newlyGenerated++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể tạo media";
      await updateScene(scene.id, {
          media_status: "failed",
          error_message: message.slice(0, 500),
        });
      log.error(
        { jobId: job.id, sceneId: scene.id, err: message },
        "scene_media_failed",
      );
    }
  }
  if (finished === 0) throw new Error("Tất cả các cảnh đều tạo media lỗi");
  await updateProject(project.id, { status: finished === scenes.length ? job.job_type === "create_video" ? "queued" : "draft" : "failed" });
  const { error: usageError } = await db.from("usage_events").insert({
    user_id: project.userId,
    project_id: project.id,
    job_id: job.id,
    kind: "ai_media_estimate",
    amount_usd: project.settings.mediaProvider === "openai" ? Number((newlyGenerated * 0.06).toFixed(2)) : 0,
    metadata: {
      successful_scenes: finished,
      total_scenes: scenes.length,
      provider: project.settings.mediaProvider,
      estimated_input_tokens: Math.ceil(project.sourceText.length / 4),
      estimated_output_tokens: Math.ceil(scenes.reduce((sum, scene) => sum + scene.narration.length, 0) / 4),
      estimated_tokens: Math.ceil(
        (project.sourceText.length + scenes.reduce((sum, scene) => sum + scene.narration.length, 0)) / 4,
      ),
      token_source: "estimate",
    },
  });
  if (usageError) throw usageError;
  if (finished < scenes.length)
    throw new Error(
      `${scenes.length - finished} cảnh tạo media lỗi; các cảnh thành công đã được giữ lại`,
    );
}

async function render(job: JobRow, project: Project) {
  checkDeadline(job);
  // If a crash happened after upload/export commit, reuse the real export.
  const { data: existing, error: exportReadError } = await db.from("exports")
    .select("storage_path,thumbnail_path").eq("job_id", job.id).maybeSingle();
  if (exportReadError) throw exportReadError;
  if (existing) {
    // Confirm both objects still exist before reporting completion.
    await download(existing.storage_path);
    await download(existing.thumbnail_path);
    await updateProject(project.id, { status: "completed" });
    return;
  }
  await updateProject(project.id, { status: "rendering" });
  const result = await renderProject(
    config,
    project,
    download,
    (value, stage) => {
      checkDeadline(job);
      return setProgress(job.id, job.job_type === "create_video" ? Math.min(99, 76 + Math.round(value * 0.23)) : value, stage);
    },
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
    const { error: exportError } = await db.from("exports").upsert(
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
    if (exportError) throw exportError;
    for (const scene of project.scenes)
      await updateScene(scene.id, { actual_duration_ms: scene.actualDurationMs });
    await updateProject(project.id, { status: "completed" });
  } finally {
    await rm(result.workdir, { recursive: true, force: true });
  }
}

async function renderDub(job: JobRow, project: Project) {
  checkDeadline(job);
  const payload = job.payload as {
    sourceVideoPath?: string;
    script?: string;
    voice?: string;
    engine?: string | null;
    subtitle?: Project["settings"]["subtitle"];
  };
  if (!payload.sourceVideoPath || !payload.script?.trim())
    throw new Error("Thiếu video upload hoặc lời thoại lồng tiếng");
  const script = payload.script.trim();
  const aligned = await localMedia.createSpeechAligned(script, payload.voice ?? project.settings.voice, {
    tts: payload.engine ?? project.settings.localModels.tts,
  });
  const scene = {
    id: crypto.randomUUID(), order: 0, narration: script, imagePrompt: "Uploaded video",
    estimatedDurationMs: Math.min(120000, Math.max(1000, aligned.durationMs)),
    actualDurationMs: aligned.durationMs, imagePath: null, videoPath: payload.sourceVideoPath,
    audioPath: "memory://dubbing-audio", thumbnailUrl: null, mediaStatus: "ready" as const,
    errorMessage: null, subtitles: aligned.cues,
  } as Scene;
  const dubProject = {
    ...project,
    sourceText: script,
    settings: { ...project.settings, subtitle: payload.subtitle ?? project.settings.subtitle },
    scenes: [scene],
  } as Project;
  await updateProject(project.id, { status: "rendering" });
  const result = await renderProject(
    config,
    dubProject,
    async (path) => path === "memory://dubbing-audio" ? aligned.audio : download(path),
    (value, stage) => setProgress(job.id, value, stage),
  );
  try {
    const outputPath = `${project.userId}/${project.id}/exports/${job.id}.mp4`;
    const thumbnailPath = `${project.userId}/${project.id}/exports/${job.id}.jpg`;
    await upload(outputPath, new Uint8Array(await readFile(result.output)), "video/mp4");
    await upload(thumbnailPath, new Uint8Array(await readFile(result.thumbnail)), "image/jpeg");
    const { error } = await db.from("exports").upsert({
      project_id: project.id, job_id: job.id, storage_path: outputPath,
      thumbnail_path: thumbnailPath, duration_ms: result.durationMs,
      width: 1080, height: 1920, status: "completed",
    }, { onConflict: "job_id" });
    if (error) throw error;
    await updateProject(project.id, { status: "completed" });
  } finally {
    await rm(result.workdir, { recursive: true, force: true });
  }
}

async function run(job: JobRow) {
  const project = await getProject(job.project_id);
  if (job.job_type === "create_video") {
    if (project.settings.textProvider !== "ollama" || project.settings.mediaProvider !== "local")
      throw new Error("Tạo video tự động chỉ dùng Ollama và media local để tránh phát sinh phí.");
    await runVideoPipeline(job.payload, {
      getProject: () => getProject(job.project_id),
      storyboard: (current) => storyboard(job, current),
      media: (current) => generateMedia(job, current),
      render: (current) => render(job, current),
      progress: (value, stage) => { checkDeadline(job); return setProgress(job.id, value, stage); },
      checkpoint: async (value) => {
        job.payload = { ...job.payload, pipeline: value };
        const { error } = await db.from("jobs").update({ payload: job.payload, heartbeat_at: new Date().toISOString() }).eq("id", job.id);
        if (error) throw error;
      },
    });
  } else if (job.job_type === "storyboard") await storyboard(job, project);
  else if (
    job.job_type === "generate_media" ||
    job.job_type === "regenerate_scene"
  )
    await generateMedia(job, project);
  else if (job.job_type === "render_video") await render(job, project);
  else if (job.job_type === "dub_video") await renderDub(job, project);
  else if (job.job_type === "render_whiteboard")
    await renderWhiteboardVideo(job.id, project, {
      config,
      db,
      download,
      upload,
      updateProject,
      updateScene,
      setProgress: (id, value, stage) => setProgress(id, value, stage),
      checkDeadline: () => checkDeadline(job),
    });
}
async function finish(job: JobRow, error?: unknown) {
  if (!error) {
    const { error: updateError } = await db
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
    if (updateError) throw updateError;
    return;
  }
  const message = error instanceof Error ? error.message : "Tác vụ gặp lỗi";
  const retry = job.attempts < job.max_attempts;
  const delaySeconds = Math.min(60, Math.pow(2, job.attempts) * 5);
  const { error: updateError } = await db
    .from("jobs")
    .update({
      status: retry ? "queued" : "failed",
      stage: retry ? `Sẽ thử lại bước lỗi sau ${delaySeconds} giây` : "Tác vụ thất bại",
      error_message: message.slice(0, 800),
      next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      locked_by: null,
      locked_at: null,
      finished_at: retry ? null : new Date().toISOString(),
    })
    .eq("id", job.id);
  if (updateError) throw updateError;
  if (!retry)
    await updateProject(job.project_id, { status: "failed" });
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
  job.deadline = Date.now() + 90 * 60_000;
  log.info({ jobId: job.id, type: job.job_type }, "job_started");
  const heartbeat = setInterval(() => {
    void db.from("jobs").update({ heartbeat_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "running").eq("locked_by", workerId)
      .then(({ error: heartbeatError }) => {
        if (heartbeatError) log.warn({ jobId: job.id }, "heartbeat_failed");
      });
  }, 30_000);
  try {
    await run(job);
    await finish(job);
    log.info({ jobId: job.id }, "job_completed");
  } catch (error) {
    await finish(job, error);
  } finally { clearInterval(heartbeat); }
}

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  healthServer.close();
});
process.on("SIGINT", () => {
  stopping = true;
  healthServer.close();
});
log.info(
  {
    workerId,
    providers: {
      anthropicStoryboard: Boolean(anthropic),
      openaiStoryboardAndMedia: Boolean(openai),
      ollamaStoryboard: true,
      localMedia: true,
    },
  },
  "worker_started",
);
while (!stopping) {
  try { await poll(); }
  catch (error) { log.error({ err: error instanceof Error ? error.message : "unknown" }, "worker_poll_failed"); }
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}
log.info("worker_stopped");
