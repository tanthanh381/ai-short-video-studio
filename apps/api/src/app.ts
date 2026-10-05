import crypto from "node:crypto";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { z, ZodError } from "zod";
import {
  cleanScriptForNarration,
  createProjectSchema,
  createVideoSchema,
  DEFAULT_PROJECT_SETTINGS,
  estimateSchema,
  projectSchema,
  projectSettingsSchema,
  type Project,
  voiceSample,
} from "@studio/shared";
import type { AppConfig } from "./config";
import type { AdminClient } from "./db";
import { mapJob, mapProject } from "./mappers";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      dailyBudgetUsd?: number;
      maxConcurrentJobs?: number;
    }
  }
}

const jobRequestSchema = z.object({
  type: z.enum([
    "storyboard",
    "generate_media",
    "regenerate_scene",
    "render_video",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  kind: z.enum(["image", "audio", "music"]),
});
const accountSettingsSchema = z.object({
  dailyBudgetUsd: z.number().min(0).max(1000),
  maxConcurrentJobs: z.number().int().min(1).max(5),
});

function safeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-100);
}
function estimateCost(project: Project, localMediaFree = false) {
  const imageCount = Math.max(
    project.scenes.length,
    Math.ceil(project.settings.targetDurationSec / 7),
  );
  const narrationCharacters = project.scenes.reduce(
    (sum, scene) => sum + scene.narration.length,
    project.sourceText.length,
  );
  const transcriptionMinutes = project.settings.targetDurationSec / 60;
  // He so cau hinh mang tinh bao thu; gia that phai doi chieu tai thoi diem su dung.
  const estimatedUsd = localMediaFree
    ? 0
    : Number(
        (
          imageCount * 0.05 +
          (narrationCharacters / 1000) * 0.03 +
          transcriptionMinutes * 0.01
        ).toFixed(2),
      );
  return estimateSchema.parse({
    imageCount,
    narrationCharacters,
    transcriptionMinutes,
    estimatedUsd,
    note: "Ước tính tham khảo; giá thực tế do nhà cung cấp AI tính theo model và chất lượng đã chọn.",
  });
}

function autoTitle(source: string) {
  let text = source;
  try { text = cleanScriptForNarration(source); } catch { /* only labels: fall back to the raw first line */ }
  return text.trim().split(/\r?\n/)[0]!.slice(0, 120) || "Video của tôi";
}

export function createApp(config: AppConfig, db: AdminClient) {
  const app = express();
  const allowedOrigins = config.ALLOWED_ORIGINS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin))
          return callback(null, true);
        callback(new Error("Nguồn truy cập không được phép"));
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.token",
        "res.headers.set-cookie",
      ],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 90,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/health", (_req, res) =>
    res.json({ ok: true, service: "ai-short-video-studio-api" }),
  );

  app.use("/v1", async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập" });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user?.email)
      return res
        .status(401)
        .json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
    const { data: access } = await db
      .from("allowed_users")
      .select("user_id,email,is_active,daily_budget_usd,max_concurrent_jobs")
      .eq("user_id", data.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!access)
      return res
        .status(403)
        .json({ error: "Tài khoản chưa được cấp quyền sử dụng studio" });
    req.userId = data.user.id;
    req.userEmail = data.user.email;
    req.dailyBudgetUsd = Number(
      access.daily_budget_usd ?? config.DAILY_BUDGET_USD,
    );
    req.maxConcurrentJobs = Number(
      access.max_concurrent_jobs ?? config.MAX_CONCURRENT_JOBS,
    );
    next();
  });

  async function loadProject(id: string, userId: string) {
    const { data: project, error } = await db
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!project) return null;
    const { data: scenes, error: sceneError } = await db
      .from("scenes")
      .select("*")
      .eq("project_id", id)
      .order("scene_order");
    if (sceneError) throw sceneError;
    return mapProject(project, scenes ?? []);
  }

  async function activeProjectJob(projectId: string, userId: string) {
    const { data, error } = await db.from("jobs").select("id")
      .eq("project_id", projectId).eq("user_id", userId)
      .in("status", ["queued", "running"]).limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  }

  function oneClickUnavailable(settings: Project["settings"]) {
    if (settings.textProvider !== "ollama" || settings.mediaProvider !== "local")
      return "Chế độ Tạo video tự động chỉ dùng Ollama và media trên máy, không gọi dịch vụ trả phí.";
    if (!config.OLLAMA_FEATURES_ENABLED)
      return "Chưa kết nối Ollama. Hãy bật Ollama trên máy tạo video.";
    if (!config.LOCAL_MEDIA_FEATURES_ENABLED)
      return "Chưa kết nối dịch vụ tạo ảnh và giọng đọc trên máy.";
    if (!config.RENDER_WORKER_ENABLED)
      return "Chưa kết nối máy xử lý video. Hãy bật worker trên máy.";
    return null;
  }

  function queueError(error: { message: string }, res: Response) {
    if (error.message.includes("VIDEO_CONCURRENCY_LIMIT")) {
      res.status(429).json({ error: "Đã có video đang xử lý. Vui lòng chờ hoặc mở dự án hiện tại để theo dõi." });
      return true;
    }
    if (error.message.includes("VIDEO_PROJECT_NOT_FOUND")) {
      res.status(404).json({ error: "Không tìm thấy dự án" });
      return true;
    }
    if (error.message.includes("VIDEO_NO_PIPELINE")) {
      res.status(409).json({ error: "Dự án này chưa có tác vụ tạo video tự động. Hãy dùng các bước chỉnh sửa trong Studio." });
      return true;
    }
    if (error.message.includes("VIDEO_ACTIVE_PROJECT_JOB")) {
      res.status(409).json({ error: "Dự án đang xử lý một tác vụ khác. Vui lòng chờ tác vụ đó hoàn tất." });
      return true;
    }
    return false;
  }

  async function removeProjectMedia(userId: string, projectId: string) {
    const bucket = db.storage.from("private-media");
    for (const directory of [
      "image",
      "audio",
      "music",
      "generated",
      "exports",
    ]) {
      const prefix = `${userId}/${projectId}/${directory}`;
      while (true) {
        const { data, error } = await bucket.list(prefix, {
          limit: 100,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) throw error;
        const paths = (data ?? [])
          .filter((item) => item.id)
          .map((item) => `${prefix}/${item.name}`);
        if (paths.length) {
          const { error: removeError } = await bucket.remove(paths);
          if (removeError) throw removeError;
        }
        if ((data ?? []).length < 100) break;
      }
    }
  }

  app.get("/v1/projects", async (req, res) => {
    const { data, error } = await db
      .from("projects")
      .select("*")
      .eq("user_id", req.userId!)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const projects = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: scenes } = await db
          .from("scenes")
          .select("*")
          .eq("project_id", row.id)
          .order("scene_order");
        return mapProject(row, scenes ?? []);
      }),
    );
    res.json(projects);
  });

  app.get("/v1/settings", (req, res) => {
    res.json({
      dailyBudgetUsd: req.dailyBudgetUsd,
      maxConcurrentJobs: req.maxConcurrentJobs,
      capabilities: {
        supabase: true,
        ai: config.AI_FEATURES_ENABLED,
        openai: config.OPENAI_FEATURES_ENABLED,
        anthropic: config.ANTHROPIC_FEATURES_ENABLED,
        ollama: config.OLLAMA_FEATURES_ENABLED,
        localMedia: config.LOCAL_MEDIA_FEATURES_ENABLED,
        render: config.RENDER_WORKER_ENABLED,
      },
    });
  });

  app.get("/v1/local-models", async (_req, res) => {
    const empty = { models: [], default: null };
    const unavailable = { available: false, storyboard: empty, image: empty, tts: empty, transcribe: empty };
    if (!config.LOCAL_MEDIA_FEATURES_ENABLED) return res.json(unavailable);
    try {
      const response = await fetch(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return res.json(unavailable);
      res.json(await response.json());
    } catch {
      res.json(unavailable); // máy tạo video chưa sẵn sàng; giao diện dùng mặc định
    }
  });

  const voicePreviews = new Map<string, Buffer>(); // ≤ 10 giọng × vài engine, câu mẫu cố định
  app.post("/v1/voice-preview", async (req, res) => {
    const input = z
      .object({ voice: z.string().max(40), engine: z.string().regex(/^[a-z0-9-]{1,20}$/u).nullish() })
      .parse(req.body);
    const sample = voiceSample(input.voice);
    if (!sample) return res.status(400).json({ error: "Giọng đọc không hợp lệ" });
    if (!config.LOCAL_MEDIA_FEATURES_ENABLED)
      return res.status(503).json({ error: "Chưa kết nối dịch vụ giọng đọc trên máy." });
    const cacheKey = `${input.voice}|${input.engine ?? ""}`;
    let audio = voicePreviews.get(cacheKey);
    if (!audio) {
      try {
        const response = await fetch(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/tts`, {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: sample, voice: input.voice, engine: input.engine ?? undefined }),
        });
        if (!response.ok) return res.status(502).json({ error: "Dịch vụ giọng đọc trên máy chưa tạo được bản nghe thử." });
        audio = Buffer.from(await response.arrayBuffer());
      } catch {
        return res.status(503).json({ error: "Không kết nối được dịch vụ giọng đọc. Hãy kiểm tra máy tạo video." });
      }
      voicePreviews.set(cacheKey, audio);
    }
    res.type("audio/mpeg").send(audio);
  });

  app.put("/v1/settings", async (req, res) => {
    const input = accountSettingsSchema.parse(req.body);
    const { error } = await db
      .from("allowed_users")
      .update({
        daily_budget_usd: input.dailyBudgetUsd,
        max_concurrent_jobs: input.maxConcurrentJobs,
      })
      .eq("user_id", req.userId!);
    if (error) throw error;
    res.json({
      ...input,
      capabilities: {
        supabase: true,
        ai: config.AI_FEATURES_ENABLED,
        openai: config.OPENAI_FEATURES_ENABLED,
        anthropic: config.ANTHROPIC_FEATURES_ENABLED,
        ollama: config.OLLAMA_FEATURES_ENABLED,
        localMedia: config.LOCAL_MEDIA_FEATURES_ENABLED,
        render: config.RENDER_WORKER_ENABLED,
      },
    });
  });

  app.post("/v1/projects", async (req, res) => {
    const input = createProjectSchema.parse(req.body);
    const { data, error } = await db
      .from("projects")
      .insert({
        user_id: req.userId,
        title: input.title,
        source_text: input.sourceText,
        input_mode: input.inputMode,
        settings: input.settings,
      })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json(mapProject(data));
  });

  app.post("/v1/videos", async (req, res) => {
    const input = createVideoSchema.parse(req.body);
    const settings = projectSettingsSchema.parse({
      ...DEFAULT_PROJECT_SETTINGS,
      textProvider: "ollama",
      mediaProvider: "local",
      voice: "vi-VN",
      ...input.settings,
    });
    const unavailable = oneClickUnavailable(settings);
    if (unavailable) return res.status(503).json({ error: unavailable });
    if (settings.backgroundMusicPath)
      return res.status(400).json({ error: "Hãy tải nhạc riêng trong Studio sau khi dự án được tạo." });
    const suppliedKey = req.headers["idempotency-key"];
    const key = suppliedKey === undefined
      ? crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")
      : z.string().min(8).max(160).regex(/^[a-zA-Z0-9:._-]+$/).parse(suppliedKey);
    const { data, error } = await db.rpc("enqueue_video", {
      p_user_id: req.userId,
      p_idempotency_key: `create-video:${key}`,
      p_source_text: input.sourceText,
      p_title: autoTitle(input.sourceText),
      p_settings: settings,
      p_max_concurrent: req.maxConcurrentJobs,
    });
    if (error) {
      if (queueError(error, res)) return;
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Không thể tạo tác vụ video");
    res.status(202).json({ project: await loadProject(row.project_id, req.userId!), job: mapJob(row) });
  });

  app.post("/v1/projects/:id/continue", async (req, res) => {
    const project = await loadProject(req.params.id, req.userId!);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });
    const unavailable = oneClickUnavailable(project.settings);
    if (unavailable) return res.status(503).json({ error: unavailable });
    const { data, error } = await db.rpc("continue_video", {
      p_user_id: req.userId,
      p_project_id: project.id,
      p_max_concurrent: req.maxConcurrentJobs,
    });
    if (error) {
      if (queueError(error, res)) return;
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Không thể khôi phục tác vụ video");
    res.status(202).json({ project: await loadProject(project.id, req.userId!), job: mapJob(row) });
  });

  app.get("/v1/projects/:id/result", async (req, res) => {
    const project = await loadProject(req.params.id, req.userId!);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });
    const { data: row, error } = await db.from("exports").select("*")
      .eq("project_id", project.id).eq("status", "completed")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!row) return res.json({ export: null, expiresIn: 300 });
    const bucket = db.storage.from("private-media");
    const [video, download, thumbnail] = await Promise.all([
      bucket.createSignedUrl(row.storage_path, 300),
      bucket.createSignedUrl(row.storage_path, 300, { download: true }),
      bucket.createSignedUrl(row.thumbnail_path, 300),
    ]);
    for (const signed of [video, download, thumbnail]) if (signed.error) throw signed.error;
    res.json({
      export: {
        id: row.id, videoUrl: video.data!.signedUrl,
        downloadUrl: download.data!.signedUrl, thumbnailUrl: thumbnail.data!.signedUrl,
        durationMs: row.duration_ms, width: row.width, height: row.height, createdAt: row.created_at,
      },
      expiresIn: 300,
    });
  });

  app.get("/v1/projects/:id", async (req, res) => {
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    res.json(project);
  });

  app.put("/v1/projects/:id", async (req, res) => {
    const input = projectSchema.parse(req.body);
    if (input.id !== req.params.id || input.userId !== req.userId)
      return res.status(403).json({ error: "Không có quyền sửa dự án này" });
    const existing = await loadProject(input.id, req.userId!);
    if (!existing) return res.status(404).json({ error: "Không tìm thấy dự án" });
    if (await activeProjectJob(input.id, req.userId!))
      return res.status(409).json({ error: "Video đang xử lý. Các chỉnh sửa tạm khóa để giữ đúng kịch bản và media; hãy chờ hoàn tất." });
    if (input.updatedAt !== existing.updatedAt)
      return res.status(409).json({ error: "Dự án đã được cập nhật. Vui lòng tải lại trước khi chỉnh sửa." });
    const prefix = `${req.userId}/${input.id}/`;
    const paths = [input.settings.backgroundMusicPath, ...input.scenes.flatMap((scene) => [scene.imagePath, scene.audioPath])];
    if (paths.some((path) => path !== null && (!path.startsWith(prefix) || path.includes(".."))))
      return res.status(403).json({ error: "Media không thuộc dự án này" });
    const rows = input.scenes.map((scene) => ({
      id: scene.id,
      project_id: input.id,
      scene_order: scene.order,
      narration: scene.narration,
      image_prompt: scene.imagePrompt,
      estimated_duration_ms: scene.estimatedDurationMs,
      actual_duration_ms: scene.actualDurationMs,
      image_path: scene.imagePath,
      audio_path: scene.audioPath,
      media_status: scene.mediaStatus,
      error_message: scene.errorMessage,
      subtitles: scene.subtitles,
    }));
    const { error } = await db.rpc("save_project", {
      p_project_id: input.id, p_user_id: req.userId,
      p_updated_at: input.updatedAt, p_project: input, p_scenes: rows,
    });
    if (error) {
      if (queueError(error, res)) return;
      if (error.message.includes("VIDEO_STALE_PROJECT"))
        return res.status(409).json({ error: "Dự án đã được cập nhật. Vui lòng tải lại trước khi chỉnh sửa." });
      if (error.message.includes("VIDEO_FOREIGN_SCENE") || error.message.includes("VIDEO_FOREIGN_MEDIA"))
        return res.status(403).json({ error: "Cảnh hoặc media không thuộc dự án này" });
      throw error;
    }
    res.json(await loadProject(input.id, req.userId!));
  });

  app.delete("/v1/projects/:id", async (req, res) => {
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    await removeProjectMedia(req.userId!, project.id);
    const { error } = await db
      .from("projects")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId!);
    if (error) throw error;
    res.status(204).send();
  });

  app.post("/v1/projects/:id/duplicate", async (req, res) => {
    const original = await loadProject(req.params.id, req.userId!);
    if (!original)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    const { data, error } = await db
      .from("projects")
      .insert({
        user_id: req.userId,
        title: `${original.title} — bản sao`,
        source_text: original.sourceText,
        input_mode: "full-script",
        hook: original.hook,
        suggested_title: original.suggestedTitle,
        suggested_description: original.suggestedDescription,
        settings: original.settings,
      })
      .select("*")
      .single();
    if (error) throw error;
    if (original.scenes.length)
      await db.from("scenes").insert(
        original.scenes.map((scene) => ({
          project_id: data.id,
          scene_order: scene.order,
          narration: scene.narration,
          image_prompt: scene.imagePrompt,
          estimated_duration_ms: scene.estimatedDurationMs,
          media_status: "pending",
          subtitles: [],
        })),
      );
    res.status(201).json(await loadProject(data.id, req.userId!));
  });

  app.get("/v1/projects/:id/estimate", async (req, res) => {
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    res.json(
      estimateCost(
        project,
        project.settings.mediaProvider === "local" && config.LOCAL_MEDIA_FEATURES_ENABLED,
      ),
    );
  });
  app.get("/v1/projects/:id/jobs", async (req, res) => {
    const { data, error } = await db
      .from("jobs")
      .select("*")
      .eq("project_id", req.params.id)
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json((data ?? []).map(mapJob));
  });

  app.post("/v1/projects/:id/jobs", async (req, res) => {
    const input = jobRequestSchema.parse(req.body);
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    if (
      ["generate_media", "render_video"].includes(input.type) &&
      project.scenes.length === 0
    ) {
      return res.status(409).json({
        error:
          "Dự án chưa có cảnh. Hãy bấm Chia cảnh hoặc Thêm cảnh trước khi tiếp tục.",
      });
    }
    if (input.type === "regenerate_scene") {
      const sceneId = String(input.payload.sceneId ?? "");
      if (!project.scenes.some((scene) => scene.id === sceneId))
        return res.status(404).json({ error: "Không tìm thấy cảnh cần tạo lại" });
    }
    const { count } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.userId!)
      .in("status", ["queued", "running"]);
    if ((count ?? 0) >= req.maxConcurrentJobs!)
      return res.status(429).json({
        error:
          "Đã đạt số tác vụ đồng thời. Vui lòng chờ tác vụ hiện tại hoàn tất.",
      });
    const estimate = estimateCost(
      project,
      project.settings.mediaProvider === "local" && config.LOCAL_MEDIA_FEATURES_ENABLED,
    );
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: usage } = await db
      .from("usage_events")
      .select("amount_usd")
      .eq("user_id", req.userId!)
      .gte("created_at", dayStart.toISOString());
    const spent = (usage ?? []).reduce(
      (sum, row) => sum + Number(row.amount_usd),
      0,
    );
    if (
      input.type === "generate_media" &&
      spent + estimate.estimatedUsd > req.dailyBudgetUsd!
    )
      return res.status(402).json({
        error: `Ước tính ${estimate.estimatedUsd.toFixed(2)} USD sẽ vượt ngân sách ngày ${req.dailyBudgetUsd!.toFixed(2)} USD.`,
      });
    const idempotency = String(
      req.headers["idempotency-key"] ?? `${input.type}:${project.updatedAt}`,
    );
    const { data, error } = await db
      .from("jobs")
      .upsert(
        {
          project_id: project.id,
          user_id: req.userId,
          job_type: input.type,
          payload: input.payload,
          idempotency_key: idempotency,
          stage: "Đã xếp hàng",
          max_attempts: 3,
        },
        { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: existing } = await db
        .from("jobs")
        .select("*")
        .eq("user_id", req.userId!)
        .eq("idempotency_key", idempotency)
        .single();
      return res.status(202).json(mapJob(existing));
    }
    await db
      .from("projects")
      .update({ status: "queued" })
      .eq("id", project.id)
      .eq("user_id", req.userId!);
    res.status(202).json(mapJob(data));
  });

  app.post("/v1/jobs/:id/retry", async (req, res) => {
    const { data: previous, error: previousError } = await db.from("jobs").select("*")
      .eq("id", req.params.id).eq("user_id", req.userId!).maybeSingle();
    if (previousError) throw previousError;
    if (!previous || previous.status !== "failed")
      return res.status(409).json({ error: "Chỉ có thể thử lại tác vụ đang lỗi" });
    if (previous.job_type === "create_video") {
      const project = await loadProject(previous.project_id, req.userId!);
      if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });
      const unavailable = oneClickUnavailable(project.settings);
      if (unavailable) return res.status(503).json({ error: unavailable });
      const { data: resumed, error: resumeError } = await db.rpc("continue_video", {
        p_user_id: req.userId, p_project_id: project.id, p_max_concurrent: req.maxConcurrentJobs,
      });
      if (resumeError) {
        if (queueError(resumeError, res)) return;
        throw resumeError;
      }
      const row = Array.isArray(resumed) ? resumed[0] : resumed;
      if (!row) throw new Error("Không thể tiếp tục tạo video");
      return res.json(mapJob(row));
    }
    const { count: active, error: activeError } = await db.from("jobs").select("id", { count: "exact", head: true })
      .eq("user_id", req.userId!).in("status", ["queued", "running"]);
    if (activeError) throw activeError;
    if ((active ?? 0) >= req.maxConcurrentJobs!)
      return res.status(429).json({ error: "Đã đạt số tác vụ đồng thời. Vui lòng chờ tác vụ hiện tại hoàn tất." });
    const { data, error } = await db
      .from("jobs")
      .update({
        status: "queued",
        attempts: 0,
        stage: "Đã xếp hàng lại",
        error_message: null,
        next_attempt_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .eq("status", "failed")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return res
        .status(409)
        .json({ error: "Chỉ có thể thử lại tác vụ đang lỗi" });
    await db
      .from("projects")
      .update({ status: "queued" })
      .eq("id", data.project_id)
      .eq("user_id", req.userId!);
    res.json(mapJob(data));
  });

  app.post("/v1/projects/:id/uploads/sign", async (req, res) => {
    const input = uploadRequestSchema.parse(req.body);
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    const allowed =
      input.kind === "image"
        ? ["image/jpeg", "image/png", "image/webp"]
        : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/x-m4a"];
    if (!allowed.includes(input.contentType))
      return res.status(415).json({ error: "Loại file không được hỗ trợ" });
    if (input.size > config.MAX_UPLOAD_MB * 1024 * 1024)
      return res
        .status(413)
        .json({ error: `File vượt quá ${config.MAX_UPLOAD_MB} MB` });
    const path = `${req.userId}/${project.id}/${input.kind}/${crypto.randomUUID()}-${safeName(input.fileName)}`;
    const { data, error } = await db.storage
      .from("private-media")
      .createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ path, token: data.token });
  });

  app.post("/v1/projects/:id/media/sign", async (req, res) => {
    const input = z
      .object({ path: z.string().min(1).max(500) })
      .parse(req.body);
    const project = await loadProject(req.params.id, req.userId!);
    if (!project)
      return res.status(404).json({ error: "Không tìm thấy dự án" });
    const prefix = `${req.userId}/${project.id}/`;
    if (!input.path.startsWith(prefix))
      return res
        .status(403)
        .json({ error: "Không có quyền truy cập media này" });
    const { data, error } = await db.storage
      .from("private-media")
      .createSignedUrl(input.path, 300);
    if (error) throw error;
    res.json({ url: data.signedUrl, expiresIn: 300 });
  });

  app.get("/v1/exports", async (req, res) => {
    const { data, error } = await db
      .from("exports")
      .select(
        "id,duration_ms,width,height,thumbnail_path,created_at,projects!inner(title,user_id)",
      )
      .eq("projects.user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const result = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: signed } = await db.storage
          .from("private-media")
          .createSignedUrl(row.thumbnail_path, 300);
        const project = row.projects as unknown as { title: string };
        return {
          id: row.id,
          projectTitle: project.title,
          durationMs: row.duration_ms,
          width: row.width,
          height: row.height,
          createdAt: row.created_at,
          thumbnailUrl: signed?.signedUrl ?? "",
        };
      }),
    );
    res.json(result);
  });

  app.get("/v1/media", async (req, res) => {
    const { data, error } = await db
      .from("scenes")
      .select("id,image_path,audio_path,projects!inner(title,user_id)")
      .eq("projects.user_id", req.userId!)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const media = (data ?? []).flatMap((row) => {
      const project = row.projects as unknown as { title: string };
      return [
        row.image_path
          ? {
              id: `${row.id}:image`,
              kind: "image" as const,
              path: row.image_path,
              projectTitle: project.title,
            }
          : null,
        row.audio_path
          ? {
              id: `${row.id}:audio`,
              kind: "audio" as const,
              path: row.audio_path,
              projectTitle: project.title,
            }
          : null,
      ].filter(
        (
          item,
        ): item is {
          id: string;
          kind: "image" | "audio";
          path: string;
          projectTitle: string;
        } => item !== null,
      );
    });
    const result = await Promise.all(
      media.map(async (item) => {
        const { data: signed } = await db.storage
          .from("private-media")
          .createSignedUrl(item.path, 300);
        return {
          id: item.id,
          kind: item.kind,
          projectTitle: item.projectTitle,
          url: signed?.signedUrl ?? "",
        };
      }),
    );
    res.json(result);
  });

  app.get("/v1/exports/:id/download", async (req, res) => {
    const { data: item } = await db
      .from("exports")
      .select("storage_path,project_id,projects!inner(user_id)")
      .eq("id", req.params.id)
      .maybeSingle();
    const owner = (item?.projects as unknown as { user_id?: string })?.user_id;
    if (!item || owner !== req.userId)
      return res.status(404).json({ error: "Không tìm thấy bản xuất" });
    const { data, error } = await db.storage
      .from("private-media")
      .createSignedUrl(item.storage_path, 300, { download: true });
    if (error) throw error;
    res.json({ url: data.signedUrl, expiresIn: 300 });
  });

  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        req.log.warn(
          { issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })) },
          "validation_failed",
        );
        return res.status(400).json({
          error: "Dữ liệu chưa hợp lệ",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      req.log.error({ err: error }, "request_failed");
      res.status(500).json({
        error:
          "Máy chủ gặp lỗi. Vui lòng thử lại; dữ liệu dự án vẫn được giữ nguyên.",
      });
    },
  );
  return app;
}
