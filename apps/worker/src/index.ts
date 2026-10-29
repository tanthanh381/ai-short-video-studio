import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { drawsByHand, paceCorrection, parseSrt, projectSchema, type Project, type Scene, visualPresetPrompt, voiceDirectionForScript } from "@studio/shared";
import { sceneMotionPrompt } from "./motion-prompts";
import { getConfig } from "./config";
import { writerModelForSettings } from "./model-policy";
import { imageLooksBlank } from "./image-check";
import { JobCancelled, ensureNotCancelled, isCancelled } from "./job-cancel";
import { fetchAirSetup } from "./air-setup";
import { AnthropicStoryboardAdapter } from "./anthropic";
import { readBalancerSettings } from "@studio/shared/balancer-store";
import { loadUserKey } from "./user-keys";
import { OllamaStoryboardAdapter, type ImageQualityAudit } from "./ollama";
import { markFatal } from "./node-errors";
import type { Lane, LaneRequest } from "./node-plan";
import { createProbe, NodePool, parseNodeSpecs, type Outcome } from "./node-pool";
import { PooledMediaAdapter } from "./pooled-media";
import { groupWords, OpenAIAdapter } from "./openai";
import { castForScript, fallbackCardTitle, PAPER_MASCOT, PAPER_STORYBOARD_STYLE, paperStagePrompt, storyNationality, usesPaperStage, usesStoryCard, withNationality } from "./card-layout";

/**
 * A full-frame img2img anchor is excellent for identity but can collapse SDXL-Turbo's pose into
 * the anchor. Paper-stage uses the bundled character reference at a low strength by default;
 * every scene receives the anchor so the fixed mascot does not drift into a different character;
 * operators can disable or tune it with PAPER_REFERENCE_MODE/PAPER_REFERENCE_STRENGTH.
 */
const PAPER_REFERENCE_MODE = ["none", "first", "alternate", "all"].includes(process.env.PAPER_REFERENCE_MODE ?? "")
  ? process.env.PAPER_REFERENCE_MODE!
  : "all";
const parsedPaperReferenceStrength = Number(process.env.PAPER_REFERENCE_STRENGTH ?? "0.08");
const PAPER_REFERENCE_STRENGTH = Number.isFinite(parsedPaperReferenceStrength)
  ? Math.max(0.05, Math.min(0.65, parsedPaperReferenceStrength))
  : 0.08;
const DEFAULT_PAPER_REFERENCE_PATH = process.env.PAPER_REFERENCE_ASSET
  || join(process.cwd(), "assets/paper-stage-character-reference.png");

async function defaultPaperReference(): Promise<string | null> {
  if (PAPER_REFERENCE_MODE === "none") return null;
  try {
    return (await readFile(DEFAULT_PAPER_REFERENCE_PATH)).toString("base64");
  } catch (error) {
    log.warn({ path: DEFAULT_PAPER_REFERENCE_PATH, err: error instanceof Error ? error.message : String(error) }, "paper_default_reference_unavailable");
    return null;
  }
}

function paperReferenceOptions(referenceImageBase64: string | null | undefined, sceneOrder: number): { referenceImageBase64?: string; referenceStrength?: number } {
  if (!referenceImageBase64 || PAPER_REFERENCE_MODE === "none") return {};
  const useReference = PAPER_REFERENCE_MODE === "all"
    // "first" means the first generated frame is the anchor for subsequent frames;
    // scene 0 cannot reference itself because the anchor is not available yet.
    || (PAPER_REFERENCE_MODE === "first" && sceneOrder > 0)
    || (PAPER_REFERENCE_MODE === "alternate" && sceneOrder % 2 === 0);
  return useReference ? { referenceImageBase64, referenceStrength: PAPER_REFERENCE_STRENGTH } : {};
}
import { cleanHashtags, fallbackPostCaption, formatPostCaption } from "./post-caption";
import { alignSpeechToScript, buildProductionImagePrompt, cleanScriptForNarration, createFaithfulStoryboard, eraAppropriateCast, fallbackImagePrompt, imageAspectFor, isEnglishPrompt, vietnameseByDefault, visualGlossary, youthfulSiblings, imageSeedFor, imageStyleFor, withCast, type MediaProvider, type StoryboardProvider } from "./providers";
import { assertDiskSpace } from "./disk-space";
import { runVideoPipeline, sceneMediaReady } from "./pipeline";
import { renderProject } from "./render";
import { regenerationPlan, type RegenerationCheckpoint } from "./regeneration";
import { trimWavSilence } from "./silence";
import { WHITEBOARD_DOWN, WHITEBOARD_STORYBOARD_STYLE, autoAnnotation, whiteboardAuditClean, whiteboardReady, withoutDrawingHand, type WhiteboardRunner } from "./whiteboard";
import { fetchPexelsImage } from "./stock-images";

const config = getConfig();
const SDXL_BASE_COMFY_MODEL = "sdxl-base-1.0-comfyui";
const log = pino({
  level: "info",
  redact: [
    "apiKey",
    "*.apiKey",
    "key",
    "*.key",
    "SUPABASE_SECRET_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "API_KEYS_SECRET",
  ],
});
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }) },
});
const openaiModels = { text: config.OPENAI_TEXT_MODEL, image: config.OPENAI_IMAGE_MODEL, tts: config.OPENAI_TTS_MODEL };
// The server's own keys (optional). An owner's own key, saved from the website, is used first for that owner's jobs.
const openai = config.OPENAI_API_KEY ? new OpenAIAdapter(config.OPENAI_API_KEY, openaiModels, config.OPENAI_BASE_URL) : null;
const anthropic = config.ANTHROPIC_API_KEY
  ? new AnthropicStoryboardAdapter(config.ANTHROPIC_API_KEY, config.ANTHROPIC_TEXT_MODEL, config.ANTHROPIC_BASE_URL)
  : null;
async function openaiFor(userId: string): Promise<OpenAIAdapter | null> {
  const key = await loadUserKey(db, config.API_KEYS_SECRET, userId, "openai");
  return key ? new OpenAIAdapter(key, openaiModels, config.OPENAI_BASE_URL) : openai;
}
async function anthropicFor(userId: string): Promise<AnthropicStoryboardAdapter | null> {
  const key = await loadUserKey(db, config.API_KEYS_SECRET, userId, "anthropic");
  return key ? new AnthropicStoryboardAdapter(key, config.ANTHROPIC_TEXT_MODEL, config.ANTHROPIC_BASE_URL) : anthropic;
}
// This machine and, when AI_NODES lists them, other Macs that share the AI work. Without AI_NODES the pool only
// forwards to this machine: same calls, same order, no probing.
const pool = new NodePool(parseNodeSpecs(config), {
  mode: config.AI_BALANCE_MODE,
  strict: config.AI_NODES_STRICT,
  minBatteryPercent: config.AI_NODE_MIN_BATTERY,
  probe: createProbe(),
  log,
  controlPower: async (spec, enabled) => {
    const response = await fetch(`${spec.mediaUrl}/node-control`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(spec.token ? { authorization: `Bearer ${spec.token}` } : {}) },
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`node-control HTTP ${response.status}`);
  },
});
/** Follows the owner's choices from Cài đặt (machines switched off, how work is split); a hiccup keeps the last choices. */
async function followBalancerSettings() {
  try {
    const settings = await readBalancerSettings(db);
    pool.applySettings(settings);
    await pool.applyPowerSettings(settings);
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, "balancer_settings_unreadable");
  }
}
const ollamaAdapters = new Map<string, OllamaStoryboardAdapter>();
/** The Ollama adapter of one machine; its requests give up when the machine is declared down. */
function ollamaOn(id: string): OllamaStoryboardAdapter {
  let adapter = ollamaAdapters.get(id);
  if (!adapter) {
    adapter = new OllamaStoryboardAdapter(
      pool.spec(id).ollamaUrl,
      config.OLLAMA_MODEL,
      { numCtx: config.OLLAMA_NUM_CTX, keepAlive: config.OLLAMA_KEEP_ALIVE },
      (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), pool.downSignal(id)]) }),
    );
    ollamaAdapters.set(id, adapter);
  }
  return adapter;
}

/** Quality images may be delegated to Air when it is the only node with SDXL Base. */
function imageModelForProject(project: Project): string | null {
  const explicit = project.settings.localModels.image?.trim();
  if (explicit) return explicit;
  return project.settings.generationPreset === "quality" && pool.hasImageModel(SDXL_BASE_COMFY_MODEL, true)
    ? SDXL_BASE_COMFY_MODEL
    : null;
}
const localMedia = new PooledMediaAdapter(pool);
/** Hand-drawing runs on whichever machine the balancer picks for each scene. */
const whiteboard: WhiteboardRunner = (work) =>
  pool.runOne("whiteboard", (node) => {
    const spec = pool.spec(node.id);
    return work({ url: spec.whiteboardUrl, token: spec.token });
  });
/** Work around a machine's answer (database, storage): its failures are not the machine's. */
async function local<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw markFatal(error);
  }
}
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
  const [ollamaReady, mediaReady, renderReady, whiteboardUp, airSetup] = await Promise.all([
    probeJson(`${config.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`),
    probeJson(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/models`),
    probeRender(),
    whiteboardReady(config),
    fetchAirSetup(config.AIR_SETUP_URL, config.AI_NODES_TOKEN),
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
      worker: { state: "healthy" as const, detail: "Đang chạy, sẵn sàng nhận việc" },
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
      whiteboard: configured(true, whiteboardUp, "Máy vẽ tay"),
    } satisfies Record<string, HealthItem>,
    balancer: pool.summary(),
    // The installation of the second machine while it is going on (null otherwise).
    airSetup,
  };
}

const healthServer = createServer(async (request, response) => {
  // The API asks for this right after the owner saves a choice in Cài đặt, instead of waiting for the next look.
  if (request.method === "POST" && request.url === "/balancer/reload") {
    await followBalancerSettings();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, balancer: pool.summary() }));
    return;
  }
  if (request.method === "POST" && request.url?.startsWith("/sync/now")) {
    const node = new URL(request.url, "http://worker").searchParams.get("node") ?? "";
    const ok = await pool.requestSync(node);
    response.writeHead(ok ? 200 : 502, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok }));
    return;
  }
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
  await ensureNotCancelled(db as never, job.id);
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
      description: s.description ?? "",
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
  if (error) {
    // The storage service answers in English; say what happened and what to do.
    if (/exceeded the maximum allowed size/iu.test(error.message))
      throw new Error(`Tệp ${Math.round(data.byteLength / 1_048_576)} MB vượt giới hạn lưu trữ 50 MB. Hãy dùng tệp nhỏ hơn hoặc chia video thành nhiều phần.`);
    throw error;
  }
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
      description: "",
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
  // Ollama can run on any machine that has the model: the balancer picks one, and moves the whole stage to another
  // if that machine goes away (nothing is saved before the very end of the stage).
  if (project.settings.textProvider === "ollama")
    {
      const selectedModel = writerModelForSettings(project.settings, pool.installedModels(), {
        defaultModel: config.OLLAMA_MODEL,
        fastModel: config.OLLAMA_FAST_MODEL,
        qualityModel: config.OLLAMA_QUALITY_MODEL,
      });
      const effectiveProject = selectedModel
        ? { ...project, settings: { ...project.settings, localModels: { ...project.settings.localModels, storyboard: selectedModel } } }
        : project;
      return pool.runOne(
        "llm",
        (node) => writeStoryboard(job, effectiveProject, ollamaOn(node.id)),
        { llmModel: selectedModel || config.OLLAMA_MODEL },
      );
    }
  return writeStoryboard(job, project, null);
}

async function writeStoryboard(job: JobRow, project: Project, ollama: OllamaStoryboardAdapter | null) {
  const providerName = project.settings.textProvider;
  const provider: StoryboardProvider | null =
    providerName === "openai"
      ? await openaiFor(project.userId)
      : providerName === "ollama"
        ? ollama
        : await anthropicFor(project.userId);
  if (!provider) {
    throw new Error(
      providerName === "openai"
        ? "Chưa có khóa API OpenAI. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn Ollama trong Tùy chọn."
        : providerName === "ollama"
          ? "Chưa kết nối Ollama hoặc chưa cài model"
          : "Chưa có khóa API Claude. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn Ollama trong Tùy chọn.",
    );
  }
  await local(() => setProgress(job.id, job.job_type === "create_video" ? 3 : 10, "Đang phân tích nội dung"));
  const sourceText = cleanScriptForNarration(project.sourceText);
  const storyboardInput = {
    title: project.title,
    sourceText,
    inputMode: project.inputMode,
    rewrite: project.settings.rewriteFullScript,
    audience: project.settings.targetAudience,
    style: project.settings.style,
    duration: project.settings.targetDurationSec,
    voice: project.settings.voice,
    voiceSpeed: project.settings.voiceSpeed,
    visualStyle: drawsByHand(project.settings)
      ? WHITEBOARD_STORYBOARD_STYLE
      : usesPaperStage(project.settings)
      ? PAPER_STORYBOARD_STYLE
      : `${project.settings.visualStyle}; ${visualPresetPrompt(project.settings.visualPreset)}`,
    model: project.settings.localModels.storyboard,
    paperStage: usesPaperStage(project.settings),
    contentQualityHints: project.settings.contentQualityHints,
  } as const;
  const cardMode = usesStoryCard(project.settings);
  // The banner/hook title and the post caption depend only on the script: draft them while the storyboard is written.
  const draftScript = cleanScriptForNarration(project.sourceText);
  const draftTitle = cardMode ? !project.settings.cardTitle.trim() : project.settings.hookTitle;
  const titleDraft = draftTitle && provider.writeCardTitle && project.inputMode === "full-script"
    ? provider.writeCardTitle({ sourceText: draftScript, model: project.settings.localModels.storyboard }).catch(() => "")
    : Promise.resolve("");
  const captionDraft = provider.writePostCaption && project.inputMode === "full-script"
    ? provider.writePostCaption({ sourceText: draftScript, title: project.title, model: project.settings.localModels.storyboard }).catch(() => null)
    : Promise.resolve(null);
  // Vietnamese unless the script is about another people ("người Nhật", "Hàn Quốc"): the cast and every prompt follow it.
  const describedPeople = storyNationality(`${project.title}\n${sourceText}`);
  const describeCast = () => provider.describeCast
    ? provider.describeCast({ title: project.title, sourceText, model: project.settings.localModels.storyboard, cartoon: cardMode, people: describedPeople.people })
    : Promise.resolve("");
  // A picture that showed another scene's narration is asked for again; say so, so a model that drifts more often shows up in the logs.
  const notes = { realigned: (event: { misaligned: number[]; repaired: number[] }) => log.warn({ jobId: job.id, projectId: project.id, ...event }, "storyboard_prompts_realigned") };
  let cast = "";
  let result;
  if (cardMode) {
    // The prompt writer must know the family up front so every scene shows the same two characters.
    cast = castForScript(sourceText, describedPeople) || await describeCast();
    result = await createFaithfulStoryboard(provider, { ...storyboardInput, cast }, notes);
  } else {
    // Cast extraction is independent of scene splitting; overlap the two Ollama
    // requests so the consistency guard does not add a full model round-trip.
    // Fixed role looks (mother in red, two brothers…) keep people recognisable better than a model-written cast.
    const scriptCast = castForScript(sourceText, describedPeople);
    [result, cast] = await Promise.all([createFaithfulStoryboard(provider, storyboardInput, notes), scriptCast ? Promise.resolve(scriptCast) : describeCast()]);
  }
  // An idea's script is only written now, so the people it names count too; the model-written cast says "Vietnamese" by habit.
  const nationality = storyNationality(`${project.title}\n${sourceText}\n${result.narration}`);
  // The "Cổ trang" look is a period story even when the script never says "ngày xưa".
  cast = eraAppropriateCast(withNationality(cast, nationality), sourceText, project.settings.visualPreset === "historical", nationality);
  // Paper stage: the same little character carries every scene (the genre's mascot), whoever the script addresses.
  if (usesPaperStage(project.settings)) cast = PAPER_MASCOT;
  checkDeadline(job);
  // One short promise-style title, written once: the story card's banner, or the hook over the first seconds of
  // a full-frame video. It is stored as the project's hook (which used to hold a copy of the script's start).
  // A pasted script is final from the start (its drafts ran alongside the storyboard); an idea's script is the
  // narration the model just wrote, so its title and caption are written from that now.
  const fromScript = project.inputMode === "full-script";
  const script = fromScript ? draftScript : result.narration;
  const shortTitle = draftTitle
    ? (fromScript ? await titleDraft : provider.writeCardTitle
      ? await provider.writeCardTitle({ sourceText: script, model: project.settings.localModels.storyboard }).catch(() => "")
      : "") || fallbackCardTitle(script)
    : "";
  let suggestedTitle = result.suggestedTitle;
  if (cardMode && shortTitle) suggestedTitle = shortTitle;
  // Post-ready caption (title, one or two sentences, hashtags) instead of the raw script.
  const post = (fromScript ? await captionDraft : provider.writePostCaption
    ? await provider.writePostCaption({ sourceText: script, title: project.title, model: project.settings.localModels.storyboard }).catch(() => null)
    : null) ?? fallbackPostCaption(script, project.title, project.settings.style);
  const caption = { ...post, hashtags: cleanHashtags(post.hashtags, project.settings.style, `${project.title} ${script}`) };
  if (project.settings.layoutTemplate !== "story-card") suggestedTitle = caption.title || suggestedTitle;
  if (providerName === "ollama" && ollama) await ollama.unload(project.settings.localModels.storyboard);
  await local(() => setProgress(job.id, job.job_type === "create_video" ? 18 : 70, "Đang lưu storyboard"));
  const imagePrompts = result.scenes.map((scene) =>
    withCast(cast, vietnameseByDefault(youthfulSiblings(scene.imagePrompt), nationality), scene.narration, cardMode));
  // Reverse-translate each English image prompt into a Vietnamese description the creator reads/edits.
  // Best-effort and capped at 4 in flight so it never dominates the storyboard step; "" on any failure
  // (and "" when no local Ollama node is available), which the UI shows as an empty, editable field.
  const descriptions: string[] = new Array(result.scenes.length).fill("");
  // Fast mode skips editor-only Vietnamese prompt descriptions: they add LLM calls but do not affect the rendered video.
  if (ollama && project.settings.generationPreset !== "fast") {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, result.scenes.length) }, async () => {
      for (let index = cursor++; index < result.scenes.length; index = cursor++) {
        descriptions[index] = await ollama
          .describeSceneVietnamese({ imagePrompt: imagePrompts[index]!, narration: result.scenes[index]!.narration, model: project.settings.localModels.storyboard })
          .catch(() => "");
      }
    }));
  }
  const rows = result.scenes.map((scene, index) => ({
    project_id: project.id,
    scene_order: index,
    narration: scene.narration,
    image_prompt: imagePrompts[index]!,
    description: descriptions[index] ?? "",
    estimated_duration_ms: scene.estimatedDurationMs,
    media_status: "pending",
    subtitles: [],
  }));
  const { error: saveError } = await db.rpc("replace_storyboard", {
    p_project_id: project.id, p_user_id: project.userId, p_scenes: rows,
    p_hook: shortTitle, p_suggested_title: suggestedTitle,
    p_suggested_description: formatPostCaption(caption),
    p_status: job.job_type === "create_video" ? "queued" : "draft",
  });
  if (saveError) throw saveError;
  // An idea is expanded into the narration stored in the scenes above. Keep the project-level
  // script in sync as well: the Studio's "Kịch bản đầy đủ" editor reads source_text, and leaving
  // the one-line idea there made a successful AI rewrite look as if nothing had happened.
  // Pasted full scripts remain untouched so the author's wording is never replaced.
  if (!fromScript) await updateProject(project.id, { source_text: script, input_mode: "full-script" });
  // Explainer theme: Claude writes one on-screen key point per scene, stored in settings (no scene-table change) and
  // drawn at the top of each scene by the renderer. A failure here must never fail the storyboard.
  if (project.settings.showKeyPoints) {
    const modelKeyPoints = provider.writeKeyPoints
      ? await provider.writeKeyPoints({ narrations: result.scenes.map((scene) => scene.narration), title: project.title }).catch(() => null)
      : null;
    // Keep Explainer usable when the optional second LLM call times out; derive a short label from approved narration.
    const keyPoints = modelKeyPoints?.some((point) => point.trim())
      ? modelKeyPoints
      : result.scenes.map((scene) => scene.narration.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().split(/\s+/u).slice(0, 6).join(" "));
    if (keyPoints.some((point) => point.trim())) {
      const { error: keyPointError } = await db
        .from("projects")
        .update({ settings: { ...project.settings, keyPoints } })
        .eq("id", project.id)
        .eq("user_id", project.userId);
      if (keyPointError) log.warn({ projectId: project.id, jobId: job.id }, "key_points_save_failed");
    }
  }
  try { await removePrefix(`${project.userId}/${project.id}/generated`); }
  catch { log.warn({ projectId: project.id, jobId: job.id }, "unused_media_cleanup_failed"); }
}

/**
 * One scene's picture. A flat or semantically unusable frame is drawn once more with another seed; if the retry still
 * fails the scene is rejected so the user can regenerate only that scene instead of exporting a bad frame.
 */
async function auditSceneImage(image: Uint8Array, scene: Scene, project: Project, job: JobRow, referenceImageBase64?: string | null): Promise<ImageQualityAudit | null> {
  const sceneText = `${scene.narration}\n${scene.imagePrompt}`;
  // Diffusion models frequently hallucinate pseudo-writing on phones, screens,
  // documents and signs. These scenes need a semantic check even in Balanced;
  // the normal Quality preset remains the strict gate for every scene.
  const textRisk = /(?:phone|smartphone|screen|display|mobile|laptop|computer|document|paper|sign|book|notebook|notepad|planner|sticky note|task card|money|cash|banknote|currency|wallet|bank(?:ing)? app|message|notification|poster|màn hình|điện thoại|tin nhắn|tờ giấy|tài liệu|tiền|lương|ví)/iu.test(sceneText);
  const paperStage = usesPaperStage(project.settings);
  const visionEnabled = process.env.VISION_QUALITY_GATE !== "false"
    // The paper-stage's main risk is semantic drift (a portrait instead of the
    // narrated everyday action), so audit it even in Balanced. This remains
    // fail-open when the local vision model is unavailable.
    && (project.settings.generationPreset === "quality" || paperStage || (textRisk && process.env.VISION_TEXT_GATE !== "false"));
  if (!visionEnabled) return null;
  try {
    return await pool.runOne("llm", (node) => ollamaOn(node.id).auditImage({
      image,
      ...(referenceImageBase64 ? { referenceImage: Buffer.from(referenceImageBase64, "base64") } : {}),
      // The generated prompt is not evidence: a vision model may repeat a desired prop
      // even when the pixels contain a book, text, or a generic portrait.
      sceneBrief: scene.narration,
      model: config.OLLAMA_VISION_MODEL,
    }), { llmModel: config.OLLAMA_VISION_MODEL });
  } catch (error) {
    log.warn({ jobId: job.id, sceneId: scene.id, err: error instanceof Error ? error.message : String(error) }, "vision_quality_gate_unavailable");
    return null;
  }
}

type SceneImage = { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" | "image/webp" };

async function drawScenePicture(provider: MediaProvider, scene: Scene, project: Project, job: JobRow, referenceImageBase64?: string | null): Promise<SceneImage> {
  const paperStage = usesPaperStage(project.settings);
  // The studio edits the Vietnamese `description`; on a description edit the web copies that text into
  // `imagePrompt`, so a non-English imagePrompt here means "re-derive the English prompt from the edit".
  // A fresh storyboard (already English) and an advanced English override both skip this, so the image
  // model always receives English without the creator having to write it.
  if (scene.description?.trim() && !isEnglishPrompt(scene.imagePrompt)) {
    const glossary = visualGlossary(`${project.title}\n${scene.narration}`);
    const nationality = storyNationality(`${project.title}\n${project.sourceText}`);
    const translated = await pool
      .runOne("llm", (node) => ollamaOn(node.id).translateImagePrompt({ narration: scene.narration, draft: scene.description, glossary, model: project.settings.localModels.storyboard }))
      .catch(() => "");
    const english = translated && isEnglishPrompt(translated) ? translated : fallbackImagePrompt(scene.narration, glossary, nationality);
    scene.imagePrompt = english;
    await updateScene(scene.id, { image_prompt: english });
  }
  const prompt = buildProductionImagePrompt(scenePicturePrompt(scene.imagePrompt, project, scene.narration), visualPresetPrompt(project.settings.visualPreset));
  const stockPreferred = !paperStage && project.settings.imageSource !== "ai";
  if (stockPreferred) {
    try {
      const stock = await fetchPexelsImage(prompt, { ...(config.PEXELS_API_KEY ? { apiKey: config.PEXELS_API_KEY } : {}), baseUrl: config.PEXELS_API_BASE_URL, aspectRatio: project.settings.aspectRatio });
      if (!(await imageLooksBlank(stock.bytes, config.FFMPEG_PATH))) {
        log.info({ jobId: job.id, sceneId: scene.id, photographer: stock.photographer, sourceUrl: stock.sourceUrl }, "scene_stock_image_selected");
        const contentType = stock.contentType === "image/webp" ? "image/webp" : stock.contentType === "image/png" ? "image/png" : "image/jpeg";
        return { bytes: stock.bytes, contentType };
      }
      throw new Error("Pexels trả về ảnh trống");
    } catch (error) {
      if (project.settings.imageSource === "stock") throw error;
      log.warn({ jobId: job.id, sceneId: scene.id, err: error instanceof Error ? error.message : String(error) }, "stock_image_fallback_to_ai");
    }
  }
  const imageModel = imageModelForProject(project);
  const options = {
    ...project.settings.localModels,
    image: imageModel,
    seed: sceneSeed(project, scene),
    style: imageStyleFor(project.settings.visualStyle, project.settings.visualPreset),
    preset: project.settings.generationPreset,
    // SDXL-Turbo can use the first paper-stage frame as a light identity anchor. ComfyUI/SDXL Base
    // intentionally remains text-to-image because the local bridge does not support img2img there.
    ...(paperStage
      ? paperReferenceOptions(referenceImageBase64, scene.order)
      : referenceImageBase64 && project.settings.generationPreset !== "quality"
        ? { referenceImageBase64 }
        : {}),
  };
  const maxAttempts = 3;
  let lastAudit: ImageQualityAudit | null = null;
  let lastBlank = false;
  let lastImage: Uint8Array | null = null;
  let correction = "";
  const whiteboardScene = drawsByHand(project.settings);
  const hasWhiteboardDrawingTools = (audit: ImageQualityAudit | null) => whiteboardScene && !!audit && !whiteboardAuditClean({ ...audit, textArtifacts: "none" });
  // Paper-stage is a highly art-directed preset: a generic portrait is a failed
  // scene even when the anatomy is technically clean. Keep its semantic gate
  // fail-closed by default; operators can temporarily disable it while bringing
  // the local vision service online, just like the broader quality gate.
  const strictQualityGate = process.env.VISION_QUALITY_GATE !== "false"
    && (project.settings.generationPreset === "quality" || (paperStage && process.env.PAPER_SEMANTIC_GATE !== "false"));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const image = await provider.createImage(`${prompt}${correction}`, imageAspectFor(project.settings), {
      ...options,
      seed: (options.seed ?? 0) + attempt * 7919,
    });
    lastImage = image;
    lastBlank = await imageLooksBlank(image, config.FFMPEG_PATH);
    lastAudit = lastBlank ? null : await auditSceneImage(image, scene, project, job, referenceImageBase64);
    // Balanced/fast may continue during a temporary Vision outage. Quality is
    // deliberately fail-closed: it must never export an image that was not
    // semantically and anatomically checked.
    const forbidsProps = /\bno prop(?: beyond the action described)?\b|\bno book\b/i.test(scene.imagePrompt);
    const whiteboardClean = !whiteboardScene || whiteboardAuditClean(lastAudit);
    const identityPass = lastAudit?.identity !== "different";
    const semanticPass = lastAudit ? (lastAudit.relevant || (forbidsProps && lastAudit.props.length === 0)) : false;
    if (!lastBlank && (lastAudit ? (semanticPass && lastAudit.anatomy !== "bad" && lastAudit.textArtifacts !== "bad" && identityPass && !(forbidsProps && lastAudit.props.length > 0) && whiteboardClean) : !strictQualityGate)) return { bytes: image, contentType: "image/png" };
    if (attempt === maxAttempts - 1) break;
    correction = lastAudit?.identity === "different"
      ? ", preserve the exact same male chibi boy as the reference: same face, short dark-brown topknot, olive ribbon, eyebrows, robe and proportions; change only the described everyday action"
      : hasWhiteboardDrawingTools(lastAudit)
      ? ", show only the story subject and objects; remove every artist, drawing hand, pen, pencil, marker, stylus and drawing tablet because a separate hand overlay is added later"
      : whiteboardScene && lastAudit?.textArtifacts !== "none"
      ? ", remove every letter, word, subtitle, logo, glyph-like scribble and pseudo-text; leave clean unlabeled illustrations only"
      : lastAudit?.anatomy === "bad"
      ? ", corrected anatomy, exactly five fingers per hand, natural hands and face, no extra fingers, no duplicated limbs"
      : lastAudit?.relevant === false
        ? ", follow the described action and important object exactly, make the main subject unmistakable"
        : lastAudit?.textArtifacts === "bad"
          ? ", remove all unintended letters, words, subtitles, logos and watermarks; clean image with no text"
        : ", clear usable scene, no blank frame, preserve the described subject and action";
    log.warn({ jobId: job.id, sceneId: scene.id, attempt: attempt + 1, blank: lastBlank, audit: lastAudit }, "scene_picture_retry");
  }
  if (lastBlank)
    throw new Error(`Ảnh cảnh ${scene.order + 1} vẫn là khung trống sau ${maxAttempts} lần thử; hãy tạo lại cảnh này`);
  if (strictQualityGate && !lastAudit)
    throw new Error(`Cổng kiểm tra chất lượng hình ảnh chưa sẵn sàng ở cảnh ${scene.order + 1}; hãy bật Ollama Vision rồi thử lại`);
  // Balanced/fast should not discard an otherwise usable scene solely because
  // a local vision model interpreted the action too narrowly. Anatomy and
  // unintended text remain hard blockers; semantic mismatch is surfaced as a
  // warning so the creator can regenerate that scene instead of losing the
  // entire video. Quality remains fail-closed above.
  if (!strictQualityGate && lastImage && lastAudit?.anatomy !== "bad" && lastAudit?.textArtifacts !== "bad" && lastAudit?.identity !== "different" && (!whiteboardScene || whiteboardAuditClean(lastAudit))) {
    log.warn({ jobId: job.id, sceneId: scene.id, audit: lastAudit }, "scene_picture_semantic_warning");
  return { bytes: lastImage, contentType: "image/png" };
  }
  // Paper-stage (chibi) last resort: a literal illustration of an abstract line (money, time, "a sincere
  // heart") keeps inducing text/garbage the gate rejects. An illustration need not depict the narration
  // exactly, so render one clean, neutral chibi image and keep the video instead of failing the whole run.
  // Quality preset stays fail-closed above.
  if (paperStage && lastAudit) {
    const safePrompt = buildProductionImagePrompt(
      `${PAPER_MASCOT}, sitting calmly on the kraft-paper stage with a gentle, thoughtful expression, both hands resting naturally, no props, absolutely no text, no letters, no numbers, no coins, no signs, no logos`,
      visualPresetPrompt(project.settings.visualPreset),
    );
    const safe = await provider.createImage(safePrompt, imageAspectFor(project.settings), { ...options, seed: (options.seed ?? 0) + 99_991 });
    const safeAudit = await imageLooksBlank(safe, config.FFMPEG_PATH) ? null : await auditSceneImage(safe, scene, project, job, referenceImageBase64);
    if (safeAudit && safeAudit.anatomy !== "bad" && safeAudit.textArtifacts !== "bad" && safeAudit.identity !== "different") {
      log.warn({ jobId: job.id, sceneId: scene.id }, "scene_picture_safe_fallback");
      return { bytes: safe, contentType: "image/png" };
    }
  }
  throw new Error(`Ảnh cảnh ${scene.order + 1} chưa đạt kiểm tra nội dung, identity, anatomy hoặc chữ rác sau ${maxAttempts} lần thử; hãy tạo lại cảnh này`);
}

async function generateMedia(job: JobRow, project: Project) {
  const media: MediaProvider | null = project.settings.mediaProvider === "openai" ? await openaiFor(project.userId) : localMedia;
  if (!media)
    throw new Error(
      "Chưa có khóa API OpenAI để tạo ảnh, giọng đọc và đồng bộ phụ đề. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn media trên máy trong Tùy chọn.",
    );
  // Motion (LTX image→video) is opt-in: it runs only when the creator explicitly turned it on for this
  // project (settings.localModels.video). LTX diffusion is slow — minutes per scene — so a still image with
  // a camera move stays the fast default. Do NOT auto-enable it just because a video lane is healthy.
  const motionModel = drawsByHand(project.settings) ? null : project.settings.localModels.video;
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
  let firstMediaError: string | undefined;
  // Generate every missing image first, then voices. Alternating the image and voice models scene by scene
  // makes them evict each other from RAM on a 16 GB Mac (minutes of swapping); one pass per model keeps each hot.
  const pendingImages = targetId ? [] : scenes.filter((scene) => !scene.imagePath);
  const prepass = pendingImages.length > 0;
  const mediaProgress = (done: number) => prepass
    ? 42 + Math.round((done / scenes.length) * 43)
    : Math.round((done / scenes.length) * 85);
  // Scenes that still lack a picture or a voice are made on every machine the balancer selects, one scene at a time on
  // each (a faster machine simply takes more of them). A single provider (OpenAI) just goes one after another.
  const pooled = media instanceof PooledMediaAdapter ? media : null;
  const batch = async <T, R>(
    lane: Lane,
    items: T[],
    work: (item: T, provider: MediaProvider, machine: string) => Promise<R>,
    request: LaneRequest,
    watchDeadline: boolean,
  ): Promise<Array<Outcome<R>>> => {
    if (pooled)
      return pooled.distribute(lane, items, (item, provider, node) => work(item, provider, node.id), {
        request,
        ...(watchDeadline ? { beforeItem: () => checkDeadline(job) } : {}),
      });
    const outcomes: Array<Outcome<R>> = [];
    for (const item of items) {
      if (watchDeadline) checkDeadline(job);
      try {
        outcomes.push({ ok: true, value: await work(item, media, "api"), nodeId: "api" });
      } catch (error) {
        outcomes.push({ ok: false, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return outcomes;
  };
  const onMachine = (machine: string) => (pooled?.distributed ? ` · máy ${machine}` : "");
  // Pin one TTS engine for the whole video. Scenes are spread across machines, and each machine would
  // otherwise pick its own engine (e.g. omnivoice on one node, vieneu on another), which changes the voice
  // mid-video. vieneu runs on every node and matches the voice presets, so it is the consistent default.
  const ttsEngine = project.settings.localModels.tts ?? "vieneu";
  const speak = async (scene: Scene, speedFactor = 1, provider: MediaProvider = media) => {
    const speed = project.settings.voiceSpeed * speedFactor;
    const voiceDirection = voiceDirectionForScript(scene.narration);
    const aligned = provider.createSpeechAligned
      ? await provider.createSpeechAligned(scene.narration, project.settings.voice, { ...project.settings.localModels, tts: ttsEngine, speed, voiceDirection })
      : null;
    let audio = aligned?.audio ?? await provider.createSpeech(scene.narration, project.settings.voice, { ...project.settings.localModels, tts: ttsEngine, speed, voiceDirection });
    // From here on the machine has answered: a failure saving it is not the machine's.
    return local(async () => {
      let subtitles = aligned?.cues ?? [];
      let alignedDurationMs = aligned?.durationMs;
      if (project.settings.trimSilence) {
        if (aligned?.contentType === "audio/wav") {
          // Cut on the bridge's WAV and move the cues with it: re-transcribing never matched Vietnamese word for word.
          const trimmed = trimWavSilence(audio, subtitles);
          audio = trimmed.wav;
          subtitles = trimmed.cues;
          alignedDurationMs = trimmed.durationMs;
        } else {
          audio = await trimAudioSilence(audio);
          subtitles = [];
          alignedDurationMs = undefined;
        }
      }
      const actualDurationMs = alignedDurationMs ?? await probeAudioDuration(audio);
      const extension = aligned?.contentType === "audio/wav" ? "wav" : "mp3";
      const audioPath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.${extension}`;
      await upload(audioPath, audio, aligned?.contentType ?? "audio/mpeg");
      // Save measured timing together with audio so retries do not transcribe
      // already aligned speech or regenerate a successful scene.
      await updateScene(scene.id, { audio_path: audioPath, subtitles, actual_duration_ms: actualDurationMs });
      return { audio, audioPath, subtitles, actualDurationMs };
    });
  };
  const ttsRequest: LaneRequest = { ttsEngine: project.settings.localModels.tts ?? null };
  // Voices are synthesised on the CPU while images render on the GPU: the two used to run one after the other
  // (the image model and the voice model fought for RAM while Ollama was still loaded; it is unloaded by now).
  const voicePrepass = prepass && !targetId
    ? (async () => {
      const firstPass = scenes.filter((item) => !item.audioPath);
      const voices = await batch("tts", firstPass, async (scene, provider) => {
        const voiced = await speak(scene, 1, provider);
        Object.assign(scene, { audioPath: voiced.audioPath, subtitles: voiced.subtitles, actualDurationMs: voiced.actualDurationMs });
      }, ttsRequest, false);
      voices.forEach((voice, index) => {
        // Not fatal: the per-scene pass below synthesises this voice again and records a clear failure.
        if (!voice.ok) log.warn({ jobId: job.id, sceneId: firstPass[index]!.id, err: voice.error.message }, "voice_prepass_failed");
      });
      // An idea is written to a chosen length, but voices read 3.8-4.1 words/s depending on the script. Measure the
      // voiced total and, when it misses by more than 8%, read every scene again at a corrected speed (still on the
      // CPU while the GPU draws), so "1 phút" comes out near a minute.
      const voicedMs = scenes.reduce((total, scene) => total + (scene.actualDurationMs ?? 0), 0);
      const factor = project.settings.generationPreset !== "fast" && project.inputMode === "idea" && scenes.every((scene) => scene.audioPath)
        ? paceCorrection(voicedMs, project.settings.targetDurationSec) : null;
      if (!factor) return;
      log.info({ jobId: job.id, voicedMs, targetSec: project.settings.targetDurationSec, factor }, "voice_pace_corrected");
      const retimed = await batch("tts", scenes, async (scene, provider) => {
        const voiced = await speak(scene, factor, provider);
        Object.assign(scene, { audioPath: voiced.audioPath, subtitles: voiced.subtitles, actualDurationMs: voiced.actualDurationMs });
      }, ttsRequest, false);
      retimed.forEach((voice, index) => {
        if (!voice.ok) log.warn({ jobId: job.id, sceneId: scenes[index]!.id, err: voice.error.message }, "voice_pace_retry_failed");
      });
    })().catch((error: unknown) => log.warn({ jobId: job.id, err: error instanceof Error ? error.message : String(error) }, "voice_prepass_aborted"))
    : Promise.resolve();
  let imagesDone = 0;
  let paperReferenceImageBase64: string | null = usesPaperStage(project.settings)
    ? await defaultPaperReference()
    : null;
  if (usesPaperStage(project.settings) && targetId) {
    const anchor = project.scenes.find((scene) => scene.id !== targetId && scene.imagePath);
    if (anchor?.imagePath) {
      try { paperReferenceImageBase64 = Buffer.from(await download(anchor.imagePath)).toString("base64"); }
      catch (error) { log.warn({ jobId: job.id, sceneId: anchor.id, err: error instanceof Error ? error.message : String(error) }, "paper_reference_unavailable"); }
    }
  }
  const imageWork = async (scene: Scene, provider: MediaProvider, machine: string) => {
    await local(async () => {
      await updateScene(scene.id, { media_status: "processing", error_message: null });
      await progress(job, Math.round((imagesDone / pendingImages.length) * 42), `Đang tạo ảnh cảnh ${scene.order + 1}${onMachine(machine)}`);
    });
    const image = await drawScenePicture(provider, scene, project, job, paperReferenceImageBase64);
    if (usesPaperStage(project.settings) && !paperReferenceImageBase64 && project.settings.generationPreset !== "quality")
      paperReferenceImageBase64 = Buffer.from(image.bytes).toString("base64");
    await local(async () => {
      const extension = image.contentType === "image/jpeg" ? "jpg" : image.contentType === "image/webp" ? "webp" : "png";
      const imagePath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.${extension}`;
      await upload(imagePath, image.bytes, image.contentType);
      await updateScene(scene.id, { image_path: imagePath });
      (scene as { imagePath: string | null }).imagePath = imagePath;
      imagesDone += 1;
    });
  };
  // A paper-stage story has one recurring mascot. Generate those frames in order so every later frame can use
  // the first successful image as a light img2img identity anchor; other layouts retain the faster balanced pool.
  const images = usesPaperStage(project.settings)
    ? await (async () => {
      const outcomes: Array<Outcome<void>> = [];
      for (const scene of pendingImages) {
        try {
          await imageWork(scene, media, "paper");
          outcomes.push({ ok: true, value: undefined, nodeId: "paper" });
        } catch (error) {
          outcomes.push({ ok: false, error: error instanceof Error ? error : new Error(String(error)) });
        }
      }
      return outcomes;
    })()
    : await batch("image", pendingImages, imageWork, { imageModel: imageModelForProject(project) }, true);
  images.forEach((image, index) => {
    // Not fatal: the per-scene pass below retries this image once more and records a clear failure.
    if (!image.ok) log.warn({ jobId: job.id, sceneId: pendingImages[index]!.id, err: image.error.message }, "image_prepass_failed");
  });
  await voicePrepass;
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
        (!motionModel || Boolean(scene.videoPath)) &&
        sceneMediaReady(scene, project.settings.subtitle.enabled)) {
        await updateScene(scene.id, { media_status: "ready", error_message: null });
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
        const image = await drawScenePicture(media, scene, project, job, paperReferenceImageBase64);
        if (usesPaperStage(project.settings) && !paperReferenceImageBase64 && project.settings.generationPreset !== "quality")
        paperReferenceImageBase64 = Buffer.from(image.bytes).toString("base64");
        const extension = image.contentType === "image/jpeg" ? "jpg" : image.contentType === "image/webp" ? "webp" : "png";
        imagePath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.${extension}`;
        await upload(imagePath, image.bytes, image.contentType);
        await updateScene(scene.id, { image_path: imagePath });
      }
      // Paper stage has its own art direction, but it still benefits from a restrained LTX
      // image-to-video pass when the video lane is genuinely ready. The motion prompt is
      // grounded in the narrated everyday action and the reference image is preserved; if
      // LTX fails, render.ts keeps the safe paper composition and falls back to camera motion.
      const paperStage = usesPaperStage(project.settings);
      const motionAvailable = media.videoAvailable ? media.videoAvailable() : true;
      if (!videoPath && motionModel && media.createVideo && motionAvailable) {
        await progress(
          job,
          mediaProgress(finished) + 2,
          `Đang tạo chuyển động LTX cảnh ${scene.order + 1}`,
        );
        try {
          const motion = await media.createVideo(
            {
              image: await download(imagePath),
              prompt: `${scene.imagePrompt}. ${sceneMotionPrompt(project.settings.visualPreset, scene.order, scene.narration)}`,
              aspectRatio: project.settings.aspectRatio,
            },
            {
              ...project.settings.localModels,
              video: motionModel,
              // The reference image carries character identity. A scene-specific
              // seed is still required so a tea, paper, garden or candle scene
              // does not collapse into the exact same frame across the project.
              seed: imageSeedFor(`${project.id}:${scene.id}`),
              preset: project.settings.generationPreset,
            },
          );
          videoPath = `${project.userId}/${project.id}/generated/${scene.id}-${Date.now()}.mp4`;
          await upload(videoPath, motion, "video/mp4");
          await updateScene(scene.id, { video_path: videoPath });
        } catch (error) {
          // Motion is an enhancement, not a reason to lose a complete export.
          // render.ts still applies a measured camera move to the source image,
          // while the scene's narration, subtitle and audio continue normally.
          log.warn({ jobId: job.id, sceneId: scene.id, err: error instanceof Error ? error.message : String(error) }, "motion_unavailable_using_camera_move");
          await progress(job, mediaProgress(finished) + 3, `Dùng camera motion cho cảnh ${scene.order + 1}`);
        }
      } else if (!videoPath && project.settings.localModels.video && !motionAvailable) {
        await progress(job, mediaProgress(finished) + 3, `Dùng camera motion cho cảnh ${scene.order + 1}`);
      }
      if (!audioPath) {
        await progress(
          job,
          mediaProgress(finished) + 4,
          `Đang tạo giọng đọc cảnh ${scene.order + 1}`,
        );
        ({ audio, audioPath, subtitles, actualDurationMs } = await speak(scene));
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
        // Whisper misreads a word or two of almost every scene, so the narration is aligned to what was heard, not demanded to equal it.
        const aligned = alignSpeechToScript(scene.narration, words);
        if (aligned.matched < aligned.total) log.info({ jobId: job.id, sceneId: scene.id, heard: aligned.matched, words: aligned.total }, "subtitles_aligned_to_speech");
        subtitles = groupWords(aligned.words);
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
      if (error instanceof JobCancelled) {
        // Not a failure of this scene: leave it as it stands (ready when both files exist) and stop the whole job.
        await updateScene(scene.id, { media_status: scene.imagePath && scene.audioPath ? "ready" : "pending", error_message: null });
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Chưa tạo được ảnh và giọng. Hãy thử lại.";
      firstMediaError ??= message;
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
  // Say why: "every scene failed" alone left the owner guessing (it was an unavailable voice engine).
  const reason = firstMediaError ? `: ${firstMediaError.slice(0, 220)}` : "";
  if (finished === 0) throw new Error(`Tất cả các cảnh đều tạo media lỗi${reason}`);
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
      `${scenes.length - finished} cảnh tạo media lỗi${reason}. Các cảnh thành công đã được giữ lại`,
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
  if (drawsByHand(project.settings)) {
    const size = project.settings.aspectRatio === "16:9"
      ? { width: 1920, height: 1080 }
      : project.settings.aspectRatio === "1:1"
        ? { width: 1080, height: 1080 }
        : { width: 1080, height: 1920 };
    for (const scene of project.scenes) {
      if (scene.annotationJson !== null) continue;
      const annotation = autoAnnotation(
        scene.id,
        size.width,
        size.height,
        scene.actualDurationMs ?? scene.estimatedDurationMs,
        scene.narration,
        scene.subtitles,
      );
      scene.annotationJson = annotation;
      await updateScene(scene.id, { annotation_json: annotation });
    }
  }
  const result = await renderProject(
    config,
    project,
    download,
    (value, stage) => {
      checkDeadline(job);
      return setProgress(job.id, job.job_type === "create_video" ? Math.min(99, 76 + Math.round(value * 0.23)) : value, stage);
    },
    { whiteboard },
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
    segments?: Array<{ startTimeMs: number; text: string }>;
    voice?: string;
    engine?: string | null;
    subtitle?: Project["settings"]["subtitle"];
  };
  if (!payload.sourceVideoPath)
    throw new Error("Thiếu video upload");

  const useSegments = payload.segments && payload.segments.length > 0;
  let aligned: any;
  let script: string;

  if (useSegments) {
    const segments = payload.segments!.sort((a, b) => a.startTimeMs - b.startTimeMs);
    const segmentTexts = segments.map((seg) => seg.text.trim()).filter(Boolean);
    if (segmentTexts.length === 0)
      throw new Error("Thiếu lời thoại lồng tiếng");

    script = segmentTexts.join(" ");
    aligned = await localMedia.createSpeechAligned(script, payload.voice ?? project.settings.voice, {
      tts: payload.engine ?? project.settings.localModels.tts,
    });
  } else {
    if (!payload.script?.trim())
      throw new Error("Thiếu lời thoại lồng tiếng");
    script = payload.script.trim();
    aligned = await localMedia.createSpeechAligned(script, payload.voice ?? project.settings.voice, {
      tts: payload.engine ?? project.settings.localModels.tts,
    });
  }

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
    { whiteboard },
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

/** One deterministic seed per scene; the shared reference image keeps the paper mascot consistent. */
function sceneSeed(project: Project, scene: Scene): number {
  return imageSeedFor(`${project.id}:${scene.id}`);
}

/** The scene's picture prompt; a hand-drawn video must not get a second hand inside the picture. */
function scenePicturePrompt(prompt: string, project: Project, narration = ""): string {
  if (usesPaperStage(project.settings)) return paperStagePrompt(prompt, narration);
  return drawsByHand(project.settings) ? withoutDrawingHand(prompt) : prompt;
}

async function run(job: JobRow) {
  const project = await getProject(job.project_id);
  // Storyboard-only work is lightweight; media and render jobs need enough room for frames,
  // audio, FFmpeg intermediates and one bounded retry. Refuse early with an actionable message
  // instead of letting the container fail with a low-level I/O error halfway through a video.
  if (["create_video", "generate_media", "regenerate_scene", "render_video", "render_whiteboard", "dub_video"].includes(job.job_type))
    await assertDiskSpace(tmpdir(), config.MIN_FREE_DISK_GB);
  // Fail before minutes of images and voices are spent, not at the render step.
  const draws = job.job_type === "render_whiteboard" || (drawsByHand(project.settings) && ["create_video", "render_video"].includes(job.job_type));
  if (draws && !pool.laneAvailable("whiteboard") && !(await whiteboardReady(config))) throw new Error(WHITEBOARD_DOWN);
  if (job.job_type === "create_video") {
    // The API already refuses a paid provider the person has no key for (paidProviderUnavailable), and the stages below read
    // that person's own key, so the one-click pipeline honours the provider chosen in the options like the manual steps do.
    await runVideoPipeline(job.payload, {
      getProject: () => getProject(job.project_id),
      storyboard: (current) => storyboard(job, current),
      media: (current) => generateMedia(job, current),
      render: (current) => render(job, current),
      progress: async (value, stage) => { checkDeadline(job); await ensureNotCancelled(db as never, job.id); await setProgress(job.id, value, stage); },
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
  // Older "Video vẽ tay" button: the same render, drawn by hand.
  else if (job.job_type === "render_whiteboard")
    await render(job, { ...project, settings: { ...project.settings, visualPreset: "whiteboard" } });
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
      .eq("id", job.id)
      .eq("status", "running"); // a job cancelled in the last moment stays cancelled
    if (updateError) throw updateError;
    return;
  }
  if (error instanceof JobCancelled) {
    // The API already marked the job cancelled; give the project back to the person for editing.
    await updateProject(job.project_id, { status: "draft" });
    log.info({ jobId: job.id }, "job_cancelled");
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
    .eq("id", job.id)
    .eq("status", "running");
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
    await ensureNotCancelled(db as never, job.id); // a cancellation swallowed as one failed scene still ends the job as cancelled
    await finish(job);
    log.info({ jobId: job.id }, "job_completed");
  } catch (error) {
    // Whatever the error was, a job the person cancelled ends as cancelled, not as failed and not retried.
    await finish(job, error instanceof JobCancelled || !(await isCancelled(db as never, job.id)) ? error : new JobCancelled());
  } finally { clearInterval(heartbeat); }
}

let stopping = false;
const settingsWatch = setInterval(() => void followBalancerSettings(), 10_000);
settingsWatch.unref();
process.on("SIGTERM", () => {
  stopping = true;
  clearInterval(settingsWatch);
  pool.stop();
  healthServer.close();
});
process.on("SIGINT", () => {
  stopping = true;
  clearInterval(settingsWatch);
  pool.stop();
  healthServer.close();
});
await followBalancerSettings(); // machines the owner switched off must not get the first job either
await pool.start(); // the first look at every machine, so the log and the first job already know who is available
log.info(
  {
    workerId,
    machines: pool.distributed ? pool.summary().nodes.map((node) => ({ id: node.id, role: node.role, state: node.state })) : [{ id: pool.primary.id, role: "primary" }],
    balanceMode: config.AI_BALANCE_MODE,
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
