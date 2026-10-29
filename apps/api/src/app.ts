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
  KEY_PROVIDER_INFO,
  cleanApiKey,
  cleanScriptForNarration,
  isKeyProvider,
  keyFormatError,
  regenerationRequestSchema,
  createProjectSchema,
  createVideoSchema,
  DEFAULT_PROJECT_SETTINGS,
  estimateSchema,
  projectSchema,
  projectSettingsSchema,
  subtitleStyleSchema,
  whiteboardAnnotationSchema,
  type AirSetupSummary,
  type BalancerSummary,
  type Project,
  voiceSample,
  type SystemJob,
  balancerModeSchema,
  nodeIdSchema,
  type BalancerSettings,
  type LocalModelCatalog,
  type SystemJobsSummary,
  type SystemSummary,
} from "@studio/shared";
import { readBalancerSettings, writeBalancerSettings } from "@studio/shared/balancer-store";
import { checkKeyWithProvider, createKeyVault } from "./api-keys";
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
    "dub_video",
    "render_whiteboard",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  kind: z.enum(["image", "audio", "music", "logo", "video"]),
});
const accountSettingsSchema = z.object({
  dailyBudgetUsd: z.number().min(0).max(1000),
  maxConcurrentJobs: z.number().int().min(1).max(5),
});

type ServiceState = "healthy" | "configured" | "offline" | "disabled" | "unknown";
type ServiceStatus = { state: ServiceState; detail: string; checkedAt: string };
type WorkerHealthPayload = {
  /** The machines sharing the AI work (empty when the worker only has its own). */
  balancer?: BalancerSummary;
  /** The installation of the second machine while it goes on (worker/src/air-setup.ts). */
  airSetup?: AirSetupSummary | null;
  services?: Partial<Record<"worker" | "render" | "openai" | "anthropic" | "localMedia", { state: ServiceState; detail: string }>>;
};

type UsageStats = {
  today: { usedUsd: number; eventCount: number; inputTokens: number; outputTokens: number; totalTokens: number };
  last30Days: { usedUsd: number; eventCount: number; totalTokens: number };
  budgetUsd: number;
  remainingUsd: number;
  budgetPercent: number;
  tokenSource: "estimated" | "recorded";
};

function safeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-100);
}
export function estimateCost(project: Project, localMediaFree = false) {
  const imageCount = Math.max(
    project.scenes.length,
    Math.ceil(project.settings.targetDurationSec / 7),
  );
  const narrationCharacters = project.scenes.reduce(
    (sum, scene) => sum + scene.narration.length,
    project.scenes.length ? 0 : project.sourceText.length,
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

/**
 * The .srt upload was removed: pasted subtitles are read as a script (their numbers and timings are stripped when
 * the narration is cleaned). An older page that still sends "srt" gets the same, instead of a database error.
 */
function readAsScript(inputMode: "idea" | "full-script" | "srt"): "idea" | "full-script" {
  return inputMode === "srt" ? "full-script" : inputMode;
}

function autoTitle(source: string) {
  let text = source;
  try { text = cleanScriptForNarration(source); } catch { /* only labels: fall back to the raw first line */ }
  return text.trim().split(/\r?\n/)[0]!.slice(0, 120) || "Video của tôi";
}

const REFUSED_ORIGIN = "Nguồn truy cập không được phép";

/** What a request-level failure means for the caller, or null when it is a genuine server fault. */
export function clientFault(error: unknown): { status: number; message: string; type: string } | null {
  const failure = error as { type?: string; status?: number; statusCode?: number; message?: string } | null;
  if (failure?.message === REFUSED_ORIGIN) return { status: 403, message: REFUSED_ORIGIN, type: "origin" };
  if (failure?.type === "entity.too.large" || failure?.status === 413 || failure?.statusCode === 413)
    return { status: 413, message: "Dữ liệu gửi lên quá lớn. Hãy rút gọn nội dung rồi thử lại.", type: "too_large" };
  if (failure?.type === "entity.parse.failed" || failure?.type === "encoding.unsupported" || failure?.type === "charset.unsupported")
    return { status: 400, message: "Dữ liệu gửi lên không đọc được. Hãy tải lại trang rồi thử lại.", type: "unreadable" };
  return null;
}

export function createApp(config: AppConfig, db: AdminClient) {
  const app = express();
  // The public API is served behind one trusted Tailscale/reverse-proxy hop.
  // Without this, express-rate-limit rejects X-Forwarded-For and every browser
  // request emits a validation warning instead of using the real client IP.
  app.set("trust proxy", 1);
  const allowedOrigins = config.ALLOWED_ORIGINS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  let serviceStatusCache: { at: number; value: Record<string, ServiceStatus> } | null = null;
  let balancerSnapshot: BalancerSummary | null = null;
  let airSetupSnapshot: AirSetupSummary | null = null;
  const keyVault = createKeyVault(db, config);

  async function getUsageStats(userId: string, budgetUsd: number): Promise<UsageStats> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(dayStart);
    monthStart.setUTCDate(monthStart.getUTCDate() - 29);
    const { data, error } = await db
      .from("usage_events")
      .select("amount_usd, metadata, created_at")
      .eq("user_id", userId)
      .gte("created_at", monthStart.toISOString());
    if (error) throw error;

    const rows = data ?? [];
    const readNumber = (metadata: unknown, ...keys: string[]) => {
      if (!metadata || typeof metadata !== "object") return 0;
      const record = metadata as Record<string, unknown>;
      for (const key of keys) {
        const value = Number(record[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
      return 0;
    };
    const isToday = (createdAt: unknown) =>
      typeof createdAt === "string" && createdAt >= dayStart.toISOString();
    const todayRows = rows.filter((row) => isToday(row.created_at));
    const sumUsd = (items: typeof rows) =>
      Number(items.reduce((sum, row) => sum + Number(row.amount_usd ?? 0), 0).toFixed(6));
    const sumTokens = (items: typeof rows, ...keys: string[]) =>
      Math.round(items.reduce((sum, row) => sum + readNumber(row.metadata, ...keys), 0));
    const todayInputTokens = sumTokens(todayRows, "input_tokens", "inputTokens", "estimated_input_tokens");
    const todayOutputTokens = sumTokens(todayRows, "output_tokens", "outputTokens", "estimated_output_tokens");
    const todayUsedUsd = sumUsd(todayRows);
    const todayTotalTokens = todayInputTokens + todayOutputTokens;
    return {
      today: {
        usedUsd: todayUsedUsd,
        eventCount: todayRows.length,
        inputTokens: todayInputTokens,
        outputTokens: todayOutputTokens,
        totalTokens: todayTotalTokens,
      },
      last30Days: {
        usedUsd: sumUsd(rows),
        eventCount: rows.length,
        totalTokens: sumTokens(rows, "total_tokens", "totalTokens", "estimated_tokens") || todayTotalTokens,
      },
      budgetUsd,
      remainingUsd: Number(Math.max(0, budgetUsd - todayUsedUsd).toFixed(6)),
      budgetPercent: budgetUsd > 0 ? Math.min(100, Number(((todayUsedUsd / budgetUsd) * 100).toFixed(1))) : 0,
      tokenSource: "estimated",
    };
  }

  async function probe(url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function collectServiceStatuses(maxAgeMs = 5_000) {
    if (serviceStatusCache && Date.now() - serviceStatusCache.at < maxAgeMs) return serviceStatusCache.value;
    const checkedAt = new Date().toISOString();
    const shouldCheckWorker = config.RENDER_WORKER_ENABLED || config.OPENAI_FEATURES_ENABLED || config.ANTHROPIC_FEATURES_ENABLED || config.OLLAMA_FEATURES_ENABLED || config.LOCAL_MEDIA_FEATURES_ENABLED;
    const [workerResponse, mediaReady] = await Promise.all([
      shouldCheckWorker
        ? fetch(`${config.WORKER_HEALTH_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2_500) })
        .then(async (response) => response.ok ? await response.json() as WorkerHealthPayload : null)
        .catch(() => null)
        : Promise.resolve(null),
      config.LOCAL_MEDIA_FEATURES_ENABLED ? probe(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/models`) : Promise.resolve(false),
    ]);
    const workerService = workerResponse?.services?.worker;
    const renderService = workerResponse?.services?.render;
    const workerUnavailable = !workerService;
    const status = (state: ServiceState, detail: string): ServiceStatus => ({ state, detail, checkedAt });
    const fromWorker = (key: keyof NonNullable<WorkerHealthPayload["services"]>, fallback: ServiceStatus) => {
      const item = workerResponse?.services?.[key];
      return item ? status(item.state, item.detail) : fallback;
    };
    const value: Record<string, ServiceStatus> = {
      api: status("healthy", "API đã phản hồi yêu cầu này"),
      supabase: status("healthy", "Đã xác thực tài khoản và truy cập được dữ liệu"),
      worker: workerUnavailable
        ? status(config.RENDER_WORKER_ENABLED ? "offline" : "disabled", config.RENDER_WORKER_ENABLED ? "Không kết nối được bộ dựng video" : "Bộ dựng video đang tắt")
        : status(workerService.state, workerService.detail),
      render: renderService
        ? status(renderService.state, renderService.detail)
        : status(config.RENDER_WORKER_ENABLED ? "offline" : "disabled", config.RENDER_WORKER_ENABLED ? "Chưa nhận được tín hiệu từ bộ dựng video" : "Bước ghép video đang tắt"),
      localMedia: status(
        config.LOCAL_MEDIA_FEATURES_ENABLED ? (mediaReady ? "healthy" : "offline") : "disabled",
        config.LOCAL_MEDIA_FEATURES_ENABLED
          ? mediaReady
            ? "Giọng đọc và phụ đề đang chạy"
            : "Không kết nối được bộ giọng đọc"
          : "Giọng đọc trên máy đang tắt",
      ),
      openai: fromWorker("openai", status(config.OPENAI_FEATURES_ENABLED ? "unknown" : "disabled", config.OPENAI_FEATURES_ENABLED ? "Chưa kiểm tra được bộ dựng video" : "Tính năng OpenAI đang tắt")),
      anthropic: fromWorker("anthropic", status(config.ANTHROPIC_FEATURES_ENABLED ? "unknown" : "disabled", config.ANTHROPIC_FEATURES_ENABLED ? "Chưa kiểm tra được bộ dựng video" : "Tính năng Claude đang tắt")),
    };
    balancerSnapshot = workerResponse?.balancer && workerResponse.balancer.nodes.length > 1 ? workerResponse.balancer : null;
    airSetupSnapshot = workerResponse?.airSetup ?? null;
    serviceStatusCache = { at: Date.now(), value };
    return value;
  }
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin))
          return callback(null, true);
        callback(new Error(REFUSED_ORIGIN));
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  // A project, scene, job or export id that is not a UUID can never exist: answer 404 here instead of letting the database
  // reject the malformed value and the request end as a 500.
  const asUuid = (_req: Request, res: Response, next: NextFunction, value: string) => {
    if (!z.string().uuid().safeParse(value).success) return res.status(404).json({ error: "Không tìm thấy nội dung này" });
    next();
  };
  app.param("id", asUuid);
  app.param("sceneId", asUuid);
  app.use(
    pinoHttp({
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.token",
        "req.body.key", // an owner's own API key (PUT /v1/api-keys/:provider)
        "res.headers.set-cookie",
      ],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      // The studio polls job status while a video is made (2 requests every 4 s) and signs media previews;
      // 90/min was reached by one open studio tab alone and answered the owner with HTTP 429.
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/health", (_req, res) =>
    res.json({ ok: true, service: "ai-short-video-studio-api" }),
  );

  app.use("/v1", async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Hãy đăng nhập để tiếp tục" });
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
    if (settings.textProvider === "ollama" && !config.OLLAMA_FEATURES_ENABLED)
      return "Chưa kết nối Ollama. Hãy bật Ollama trên máy tạo video.";
    if (settings.mediaProvider === "local" && !config.LOCAL_MEDIA_FEATURES_ENABLED)
      return "Chưa kết nối dịch vụ tạo ảnh và giọng đọc trên máy.";
    if (!config.RENDER_WORKER_ENABLED)
      return "Máy tạo video chưa kết nối. Kiểm tra máy chính đang bật rồi thử lại.";
    return null;
  }

  async function paidProviderUnavailable(settings: Project["settings"], userId: string) {
    const baseError = oneClickUnavailable(settings);
    if (baseError) return baseError;

    const needsPaidProvider =
      settings.textProvider === "openai" ||
      settings.textProvider === "anthropic" ||
      settings.mediaProvider === "openai";
    if (!needsPaidProvider) return null;

    const view = await accountView(userId);
    const providers = new Set<"openai" | "anthropic">();
    if (settings.textProvider === "openai" || settings.textProvider === "anthropic") providers.add(settings.textProvider);
    if (settings.mediaProvider === "openai") providers.add("openai");
    for (const provider of providers) {
      if (!view.capabilities[provider]) {
        return `Chưa có khóa API ${KEY_PROVIDER_INFO[provider].name}. Hãy dán khóa ở Cài đặt → Dịch vụ trả phí rồi thử lại.`;
      }
    }
    return null;
  }

  function queueError(error: { message: string }, res: Response) {
    if (error.message.includes("VIDEO_CONCURRENCY_LIMIT")) {
      res.status(429).json({ error: "Đang có một video được tạo. Hãy chờ video đó xong, hoặc mở dự án để theo dõi." });
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
      res.status(409).json({ error: "Dự án đang làm một việc khác. Hãy chờ việc đó xong rồi thử lại." });
      return true;
    }
    return false;
  }

  async function removeProjectMedia(userId: string, projectId: string) {
    const bucket = db.storage.from("private-media");
    for (const directory of [
      "image",
      "logo",
      "audio",
      "music",
      "video",
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

  /**
   * What the owner can use right now. OpenAI and Claude are available when the owner saved their own key, or when the
   * server has a shared one (the worker reports it as configured); the server switch can still turn a provider off.
   */
  async function accountView(userId: string) {
    const [apiKeys, statuses] = await Promise.all([keyVault.summary(userId), collectServiceStatuses()]);
    const sharedKey = (id: "openai" | "anthropic") => statuses[id]?.state === "configured" || statuses[id]?.state === "healthy";
    const checkedAt = new Date().toISOString();
    const serviceStatuses: Record<string, ServiceStatus> = { ...statuses };
    for (const id of ["openai", "anthropic"] as const) {
      const saved = apiKeys.keys[id];
      if (saved.saved)
        serviceStatuses[id] = { state: "configured", detail: `Đang dùng khóa API của bạn (…${saved.last4 ?? ""})`, checkedAt };
      else if (!sharedKey(id))
        serviceStatuses[id] = { state: "disabled", detail: "Chưa có khóa API. Dán khóa của bạn ở Cài đặt để dùng.", checkedAt };
    }
    const flag = { openai: config.OPENAI_FEATURES_ENABLED, anthropic: config.ANTHROPIC_FEATURES_ENABLED };
    return {
      apiKeys,
      capabilities: {
        supabase: true,
        ai: config.AI_FEATURES_ENABLED,
        openai: flag.openai && (apiKeys.keys.openai.saved || sharedKey("openai")),
        anthropic: flag.anthropic && (apiKeys.keys.anthropic.saved || sharedKey("anthropic")),
        ollama: config.OLLAMA_FEATURES_ENABLED,
        localMedia: config.LOCAL_MEDIA_FEATURES_ENABLED,
        render: config.RENDER_WORKER_ENABLED,
      },
      serviceStatuses,
      // Other Macs that share the work and what the balancer last decided; null while only this machine is used.
      balancer: balancerSnapshot,
      // How far installing the second machine has got (null when no installation is going on).
      airSetup: airSetupSnapshot,
    };
  }

  /** What the dashboard says about the owner's jobs: how many are going, how the last day went, the latest few. */
  async function getJobsSummary(userId: string): Promise<SystemJobsSummary> {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [active, finished, recent] = await Promise.all([
      db.from("jobs").select("status").eq("user_id", userId).in("status", ["queued", "running"]),
      db.from("jobs").select("job_type, status, started_at, finished_at").eq("user_id", userId).in("status", ["completed", "failed"]).gte("finished_at", since),
      db.from("jobs").select("id, job_type, status, stage, progress, started_at, finished_at, projects(title)").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    ]);
    for (const result of [active, finished, recent]) if (result.error) throw result.error;
    const seconds = (from: unknown, to: unknown) =>
      typeof from === "string" && typeof to === "string" ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null;
    const done = finished.data ?? [];
    const videos = done.filter((row) => row.job_type === "create_video" && row.status === "completed")
      .map((row) => seconds(row.started_at, row.finished_at)).filter((value): value is number => value !== null);
    return {
      running: (active.data ?? []).filter((row) => row.status === "running").length,
      queued: (active.data ?? []).filter((row) => row.status === "queued").length,
      completed24h: done.filter((row) => row.status === "completed").length,
      failed24h: done.filter((row) => row.status === "failed").length,
      avgVideoSeconds24h: videos.length ? Math.round(videos.reduce((sum, value) => sum + value, 0) / videos.length) : null,
      recent: (recent.data ?? []).map((row): SystemJob => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        const running = row.status === "running";
        return {
          id: String(row.id), type: String(row.job_type), title: typeof project?.title === "string" ? project.title : "",
          status: row.status as SystemJob["status"], stage: String(row.stage ?? ""), progress: Number(row.progress ?? 0),
          startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null,
          durationSeconds: seconds(row.started_at, running ? new Date().toISOString() : row.finished_at),
        };
      }),
    };
  }

  // The "Hệ thống" dashboard: the machines, the models they hold, the services and the jobs, refreshed every few seconds.
  app.get("/v1/system", async (req, res) => {
    const services = await collectServiceStatuses(1_500);
    const body: SystemSummary = { checkedAt: new Date().toISOString(), balancer: balancerSnapshot, services, jobs: await getJobsSummary(req.userId!) };
    res.json(body);
  });

  // Cài đặt → "Máy xử lý video": switch a machine off or on, choose how work is split. Saved in the private bucket; the worker
  // follows it (and is told right away so the page can show the result at once).
  const balancerChoice = z.object({ mode: balancerModeSchema.nullable().optional(), disabled: z.array(nodeIdSchema).max(16).optional() });
  app.put("/v1/balancer", async (req, res) => {
    const input = balancerChoice.parse(req.body);
    await collectServiceStatuses(1_500);
    const known = balancerSnapshot?.nodes.map((node) => node.id) ?? [];
    if (!known.length) return res.status(409).json({ error: "Chưa có máy phụ nào để bật hoặc tắt. Thêm máy phụ trước (xem hướng dẫn trong docs/TU-HOST.md)." });
    const unknown = (input.disabled ?? []).filter((id) => !known.includes(id));
    if (unknown.length) return res.status(400).json({ error: `Không có máy tên ${unknown.join(", ")}` });
    if (input.disabled && input.disabled.length >= known.length) return res.status(400).json({ error: "Cần giữ ít nhất một máy đang bật để làm video." });
    const saved = await readBalancerSettings(db);
    const next: BalancerSettings = {
      mode: input.mode === undefined ? saved.mode : input.mode,
      disabled: [...new Set(input.disabled ?? saved.disabled)],
    };
    await writeBalancerSettings(db, next);
    req.log.info({ mode: next.mode, disabled: next.disabled }, "balancer_settings_saved");
    // best effort: the worker also re-reads the file every ten seconds
    let applied = false;
    try {
      const reply = await fetch(`${config.WORKER_HEALTH_URL.replace(/\/$/, "")}/balancer/reload`, { method: "POST", signal: AbortSignal.timeout(2_500) });
      if (reply.ok) {
        const body = (await reply.json()) as { balancer?: BalancerSummary };
        if (body.balancer && body.balancer.nodes.length > 1) balancerSnapshot = body.balancer;
        serviceStatusCache = null;
        applied = true;
      }
    } catch {
      applied = false;
    }
    res.json({ settings: next, applied, balancer: balancerSnapshot });
  });

  // Cài đặt → "Đồng bộ ngay": asks the worker, which asks that machine's bridge, which wakes the sync agent there.
  app.post("/v1/sync/:node", async (req, res) => {
    const node = nodeIdSchema.safeParse(req.params.node);
    if (!node.success) return res.status(400).json({ error: "Tên máy không hợp lệ" });
    await collectServiceStatuses(1_500);
    const target = balancerSnapshot?.nodes.find((item) => item.id === node.data);
    if (!target) return res.status(404).json({ error: `Không có máy tên ${node.data}` });
    if (target.role === "primary") return res.status(400).json({ error: "Máy chính là nguồn: không có gì để đồng bộ về máy này." });
    try {
      const reply = await fetch(`${config.WORKER_HEALTH_URL.replace(/\/$/, "")}/sync/now?node=${encodeURIComponent(node.data)}`, { method: "POST", signal: AbortSignal.timeout(6_000) });
      if (!reply.ok) return res.status(502).json({ error: `Máy ${node.data} chưa nhận được yêu cầu (chưa cài tiến trình đồng bộ, hoặc máy đang offline).` });
    } catch {
      return res.status(502).json({ error: "Chưa gửi được yêu cầu đồng bộ. Kiểm tra máy chính đang bật rồi thử lại." });
    }
    req.log.info({ node: node.data }, "sync_requested");
    res.json({ ok: true });
  });

  app.get("/v1/settings", async (req, res) => {
    res.json({
      dailyBudgetUsd: req.dailyBudgetUsd,
      maxConcurrentJobs: req.maxConcurrentJobs,
      usageStats: await getUsageStats(req.userId!, req.dailyBudgetUsd!),
      ...(await accountView(req.userId!)),
    });
  });

  // Attempts per owner, so this endpoint cannot be used to try many keys against a provider.
  const keyAttempts = new Map<string, number[]>();
  function tooManyKeyAttempts(userId: string) {
    const now = Date.now();
    const recent = (keyAttempts.get(userId) ?? []).filter((at) => now - at < 10 * 60_000);
    if (recent.length >= 8) {
      keyAttempts.set(userId, recent);
      return true;
    }
    keyAttempts.set(userId, [...recent, now]);
    return false;
  }

  app.put("/v1/api-keys/:provider", async (req, res) => {
    const provider = req.params.provider ?? "";
    if (!isKeyProvider(provider)) return res.status(404).json({ error: "Nhà cung cấp không được hỗ trợ" });
    if (!keyVault.enabled)
      return res.status(503).json({ error: "Máy chủ chưa bật lưu khóa API (thiếu API_KEYS_SECRET). Hãy báo người quản trị máy." });
    const { key } = z.object({ key: z.string().max(500) }).parse(req.body);
    const formatError = keyFormatError(provider, key);
    if (formatError) return res.status(400).json({ error: formatError });
    if (tooManyKeyAttempts(req.userId!))
      return res.status(429).json({ error: "Bạn đã thử khóa quá nhiều lần. Hãy đợi vài phút rồi thử lại." });
    const check = await checkKeyWithProvider(config, provider, key);
    if (!check.ok) return res.status(check.reason === "invalid" ? 400 : 502).json({ error: check.message });
    await keyVault.save(req.userId!, provider, cleanApiKey(key));
    req.log.info({ provider }, "api_key_saved"); // the key itself is never logged
    res.json({ ...(check.warning ? { warning: check.warning } : {}), ...(await accountView(req.userId!)) });
  });

  app.delete("/v1/api-keys/:provider", async (req, res) => {
    const provider = req.params.provider ?? "";
    if (!isKeyProvider(provider)) return res.status(404).json({ error: "Nhà cung cấp không được hỗ trợ" });
    await keyVault.remove(req.userId!, provider);
    req.log.info({ provider }, "api_key_removed");
    res.json(await accountView(req.userId!));
  });

  app.get("/v1/local-models", async (_req, res) => {
    const empty = { models: [], default: null };
    const unavailable = { available: false, storyboard: empty, image: empty, video: empty, tts: empty, transcribe: empty };
    if (!config.LOCAL_MEDIA_FEATURES_ENABLED) return res.json(unavailable);
    try {
      const response = await fetch(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return res.json(unavailable);
      const catalog = await response.json() as LocalModelCatalog;
      // The media bridge is local to the primary Mac, while the worker may have a
      // secondary Mac that can wake LTX on demand. Keep the picker honest about
      // the whole pool so a publish-ready one-click job does not silently fall
      // back just because Mini's 16 GB runtime reports no ready LTX process.
      if (!catalog.video?.models?.length) {
        try {
          const worker = await fetch(`${config.WORKER_HEALTH_URL.replace(/\/$/, "")}/health`, {
            signal: AbortSignal.timeout(2_500),
          });
          if (worker.ok) {
            const health = await worker.json() as WorkerHealthPayload;
            const hasVideoLane = health.balancer?.nodes.some((node) =>
              node.state === "healthy" && node.enabled !== false && node.lanes?.video?.eligible,
            );
            if (hasVideoLane) {
              catalog.video = {
                models: [{ id: "ltxv-2b-0.9.8-distilled", label: "LTX-Video 2B Distilled (I2V)" }],
                default: "ltxv-2b-0.9.8-distilled",
              };
            }
          }
        } catch {
          // The primary catalog remains authoritative when the worker health endpoint is unavailable.
        }
      }
      res.json(catalog);
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

  app.post("/v1/text-to-speech", async (req, res) => {
    const input = z
      .object({
        text: z.string().trim().min(1, "Văn bản cần đọc không được để trống").max(10_000),
        voice: z.string().max(40),
        engine: z.string().regex(/^[a-z0-9-]{1,20}$/u).nullish(),
        speed: z.number().min(0.75).max(1.25).default(1),
      })
      .parse(req.body);
    if (!voiceSample(input.voice)) return res.status(400).json({ error: "Giọng đọc không hợp lệ" });
    if (!config.LOCAL_MEDIA_FEATURES_ENABLED)
      return res.status(503).json({ error: "Chưa kết nối dịch vụ giọng đọc trên máy." });
    try {
      const response = await fetch(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/, "")}/tts`, {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input.text, voice: input.voice, engine: input.engine ?? undefined, speed: input.speed }),
      });
      if (!response.ok) return res.status(502).json({ error: "Dịch vụ giọng đọc chưa tạo được audio." });
      res.type("audio/mpeg").send(Buffer.from(await response.arrayBuffer()));
    } catch {
      return res.status(503).json({ error: "Không kết nối được dịch vụ giọng đọc. Hãy kiểm tra máy tạo video." });
    }
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
      usageStats: await getUsageStats(req.userId!, input.dailyBudgetUsd),
      ...(await accountView(req.userId!)),
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
        input_mode: readAsScript(input.inputMode),
        settings: input.settings,
      })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json(mapProject(data));
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
      return res.status(409).json({ error: "Dự án đã được cập nhật ở nơi khác. Hãy tải lại trang trước khi sửa tiếp." });
    const prefix = `${req.userId}/${input.id}/`;
    const paths = [input.settings.backgroundMusicPath, input.settings.logoPath, ...input.scenes.flatMap((scene) => [scene.imagePath, scene.videoPath, scene.audioPath])];
    if (paths.some((path) => path !== null && (!path.startsWith(prefix) || path.includes(".."))))
      return res.status(403).json({ error: "Media không thuộc dự án này" });
    const rows = input.scenes.map((scene) => ({
      id: scene.id,
      project_id: input.id,
      scene_order: scene.order,
      narration: scene.narration,
      image_prompt: scene.imagePrompt,
      description: scene.description,
      estimated_duration_ms: scene.estimatedDurationMs,
      actual_duration_ms: scene.actualDurationMs,
      image_path: scene.imagePath,
      video_path: scene.videoPath,
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
        return res.status(409).json({ error: "Dự án đã được cập nhật ở nơi khác. Hãy tải lại trang trước khi sửa tiếp." });
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
          description: scene.description,
          estimated_duration_ms: scene.estimatedDurationMs,
          media_status: "pending",
          subtitles: [],
        })),
      );
    res.status(201).json(await loadProject(data.id, req.userId!));
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
      ["generate_media", "render_video", "render_whiteboard"].includes(input.type) &&
      project.scenes.length === 0
    ) {
      return res.status(409).json({
        error:
          "Dự án chưa có cảnh. Hãy bấm Chia cảnh hoặc Thêm cảnh trước khi tiếp tục.",
      });
    }
    if (input.type === "render_whiteboard") {
      if (!project.scenes.some(s => s.imagePath))
        return res.status(409).json({ error: "Cần tạo ảnh cho ít nhất một cảnh trước khi render video vẽ tay." });
      const noAudio = project.scenes.filter(s => s.imagePath && !s.audioPath);
      if (noAudio.length)
        return res.status(409).json({
          error: `${noAudio.length} cảnh có ảnh nhưng chưa có giọng đọc (cảnh ${noAudio.map(s => s.order + 1).join(", ")}). Hãy tạo giọng đọc trước.`,
        });
    }
    {
      // Say so now when the project uses a paid provider the owner has no key for, instead of queueing a job that fails.
      const needs = input.type === "storyboard" && (project.settings.textProvider === "openai" || project.settings.textProvider === "anthropic")
        ? project.settings.textProvider
        : (input.type === "generate_media" || input.type === "regenerate_scene") && project.settings.mediaProvider === "openai"
          ? "openai"
          : null;
      if (needs) {
        const view = await accountView(req.userId!);
        if (!view.capabilities[needs])
          return res.status(409).json({
            error: `Chưa có khóa API ${KEY_PROVIDER_INFO[needs].name}. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn Ollama và media trên máy trong Tùy chọn.`,
          });
      }
    }
    if (input.type === "regenerate_scene") {
      input.payload = regenerationRequestSchema.parse(input.payload);
      const sceneId = String(input.payload.sceneId ?? "");
      if (!project.scenes.some((scene) => scene.id === sceneId))
        return res.status(404).json({ error: "Không tìm thấy cảnh cần tạo lại" });
    }
    if (input.type === "dub_video") {
      const dubSegment = z.object({
        startTimeMs: z.number().min(0).max(3600000),
        text: z.string().min(1).max(2000),
      });
      const dub = z.object({
        sourceVideoPath: z.string().min(1).max(500),
        script: z.string().trim().min(1).max(10000).optional(),
        segments: z.array(dubSegment).optional(),
        voice: z.string().max(40),
        engine: z.string().regex(/^[a-z0-9-]{1,20}$/u).nullish(),
        subtitle: subtitleStyleSchema.optional(),
      }).parse(input.payload);
      const prefix = `${req.userId}/${project.id}/video/`;
      if (!dub.sourceVideoPath.startsWith(prefix) || dub.sourceVideoPath.includes(".."))
        return res.status(403).json({ error: "Video upload không thuộc dự án này" });
      if (!dub.script && (!dub.segments || dub.segments.length === 0))
        return res.status(400).json({ error: "Cần cung cấp script hoặc segments" });
      input.payload = dub;
    }
    const { count } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.userId!)
      .in("status", ["queued", "running"]);
    if ((count ?? 0) >= req.maxConcurrentJobs!)
      return res.status(429).json({
        error:
          "Đang chạy đủ số video cùng lúc. Hãy chờ một video xong rồi thử lại.",
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

  app.post("/v1/jobs/:id/cancel", async (req, res) => {
    const { data: job, error: readError } = await db.from("jobs").select("*")
      .eq("id", req.params.id).eq("user_id", req.userId!).maybeSingle();
    if (readError) throw readError;
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    if (job.status !== "queued" && job.status !== "running")
      return res.status(409).json({ error: "Tác vụ này đã kết thúc nên không còn gì để hủy" });
    // Only a job that is still queued or running can be cancelled; the worker notices at its next step and keeps finished scenes.
    const { data: cancelled, error } = await db.from("jobs")
      .update({ status: "cancelled", stage: "Đã hủy theo yêu cầu", finished_at: new Date().toISOString(), error_message: null })
      .eq("id", job.id).in("status", ["queued", "running"]).select("*").maybeSingle();
    if (error) throw error;
    if (!cancelled) return res.status(409).json({ error: "Tác vụ vừa kết thúc nên không hủy được" });
    const { error: projectError } = await db.from("projects").update({ status: "draft" })
      .eq("id", job.project_id).eq("user_id", req.userId!);
    if (projectError) throw projectError;
    res.json(mapJob(cancelled));
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
      const unavailable = await paidProviderUnavailable(project.settings, req.userId!);
      if (unavailable) return res.status(503).json({ error: unavailable });
      const { data: resumed, error: resumeError } = await db.rpc("continue_video", {
        p_user_id: req.userId, p_project_id: project.id, p_max_concurrent: req.maxConcurrentJobs,
      });
      if (resumeError) {
        if (queueError(resumeError, res)) return;
        throw resumeError;
      }
      const row = Array.isArray(resumed) ? resumed[0] : resumed;
      if (!row) throw new Error("Chưa tiếp tục tạo video được. Hãy thử lại.");
      return res.json(mapJob(row));
    }
    const { count: active, error: activeError } = await db.from("jobs").select("id", { count: "exact", head: true })
      .eq("user_id", req.userId!).in("status", ["queued", "running"]);
    if (activeError) throw activeError;
    if ((active ?? 0) >= req.maxConcurrentJobs!)
      return res.status(429).json({ error: "Đang chạy đủ số video cùng lúc. Hãy chờ một video xong rồi thử lại." });
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
      input.kind === "image" || input.kind === "logo"
        ? ["image/jpeg", "image/png", "image/webp"]
        : input.kind === "video"
          ? ["video/mp4", "video/webm", "video/quicktime"]
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
      .select("id,image_path,video_path,audio_path,projects!inner(title,user_id)")
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
        row.video_path
          ? {
              id: `${row.id}:video`,
              kind: "video" as const,
              path: row.video_path,
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
          kind: "image" | "video" | "audio";
          path: string;
          projectTitle: string;
        } => item !== null,
      );
    });
    // One storage call for every picture and voice: signing them one by one took 11 s for 110 files.
    const { data: signedBatch } = media.length
      ? await db.storage.from("private-media").createSignedUrls(media.map((item) => item.path), 300)
      : { data: [] as Array<{ path: string | null; signedUrl: string }> };
    const urlByPath = new Map((signedBatch ?? []).map((entry) => [entry.path, entry.signedUrl]));
    const result = media.map((item) => ({
      id: item.id,
      kind: item.kind,
      projectTitle: item.projectTitle,
      url: urlByPath.get(item.path) ?? "",
    }));
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
      // Errors raised before the request logger exists (a refused origin, an unreadable or oversized body) are the caller's
      // mistake, not a server fault: answer them in the API's own JSON with the right 4xx instead of a bare HTML 500.
      const known = clientFault(error);
      if (known) {
        req.log?.warn({ type: known.type }, "request_refused");
        return res.status(known.status).json({ error: known.message });
      }
      (req.log ?? console).error({ err: error }, "request_failed");
      res.status(500).json({
        error:
          "Có lỗi bất ngờ. Hãy thử lại; dữ liệu dự án vẫn được giữ nguyên.",
      });
    },
  );
  return app;
}
