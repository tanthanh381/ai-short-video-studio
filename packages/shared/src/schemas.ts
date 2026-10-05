import { z } from "zod";

export const videoStyleSchema = z.enum([
  "ke-chuyen",
  "kien-thuc",
  "truyen-cam-hung",
  "meo-cuoc-song",
]);

export const aspectRatioSchema = z.enum(["9:16", "1:1", "16:9"]);
export const projectStatusSchema = z.enum([
  "draft",
  "generating_media",
  "queued",
  "rendering",
  "completed",
  "failed",
]);

export const subtitleStyleSchema = z.object({
  enabled: z.boolean().default(true),
  preset: z.enum(["classic", "focus", "minimal"]).default("classic"),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  fontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#FFFFFF"),
  outlineColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#101828"),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#000000"),
  backgroundOpacity: z.number().min(0).max(1).default(0.35),
});

export const subtitleCueSchema = z
  .object({
    id: z.string().uuid(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    text: z.string().min(1).max(240),
  })
  .refine((cue) => cue.endMs > cue.startMs, {
    message: "Thoi diem ket thuc phai sau thoi diem bat dau",
  });

export const sceneSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().min(0),
  narration: z.string().min(1).max(2000),
  imagePrompt: z.string().min(1).max(3000),
  estimatedDurationMs: z.number().int().min(1000).max(120000),
  actualDurationMs: z
    .number()
    .int()
    .min(100)
    .max(180000)
    .nullable()
    .default(null),
  imagePath: z.string().nullable().default(null),
  audioPath: z.string().nullable().default(null),
  thumbnailUrl: z.string().url().nullable().default(null),
  mediaStatus: z
    .enum(["pending", "processing", "ready", "failed"])
    .default("pending"),
  errorMessage: z.string().nullable().default(null),
  subtitles: z.array(subtitleCueSchema).default([]),
});

const localModelName = z
  .string()
  .regex(/^[\w.:/-]{1,100}$/u, "Tên model không hợp lệ")
  .nullable()
  .default(null);

/** Model AI chạy trên máy theo từng tác vụ; null = dùng mặc định của máy. */
export const localModelsSchema = z.object({
  storyboard: localModelName,
  image: localModelName,
  tts: localModelName,
  transcribe: localModelName,
});
export type LocalModels = z.infer<typeof localModelsSchema>;
export const DEFAULT_LOCAL_MODELS: LocalModels = {
  storyboard: null,
  image: null,
  tts: null,
  transcribe: null,
};

export const projectSettingsSchema = z.object({
  textProvider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
  mediaProvider: z.enum(["local", "openai"]).default("local"),
  targetAudience: z.string().max(500).default("Người xem Việt Nam"),
  style: videoStyleSchema.default("ke-chuyen"),
  targetDurationSec: z
    .union([z.literal(30), z.literal(60), z.literal(90)])
    .default(60),
  aspectRatio: aspectRatioSchema.default("9:16"),
  voice: z.string().default("alloy"),
  localModels: localModelsSchema.default(DEFAULT_LOCAL_MODELS),
  visualStyle: z.string().max(500).default("Ảnh điện ảnh chân thực, ánh sáng tự nhiên, nhân vật Việt Nam"),
  allowUploads: z.boolean().default(true),
  backgroundMusicPath: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(0.5).default(0.12),
  rewriteFullScript: z.boolean().default(false),
  subtitle: subtitleStyleSchema.default({
    enabled: true,
    preset: "classic",
    position: "bottom",
    fontColor: "#FFFFFF",
    outlineColor: "#101828",
    backgroundColor: "#000000",
    backgroundOpacity: 0.35,
  }),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(160),
  sourceText: z.string().min(1).max(30000),
  inputMode: z.enum(["idea", "full-script"]).default("idea"),
  hook: z.string().max(500).default(""),
  suggestedTitle: z.string().max(200).default(""),
  suggestedDescription: z.string().max(2000).default(""),
  status: projectStatusSchema.default("draft"),
  settings: projectSettingsSchema,
  scenes: z.array(sceneSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Vui lòng nhập tên video").max(160),
  sourceText: z
    .string()
    .trim()
    .min(10, "Ý tưởng hoặc kịch bản cần ít nhất 10 ký tự")
    .max(30000),
  inputMode: z.enum(["idea", "full-script"]).default("idea"),
  settings: projectSettingsSchema,
});

export const createVideoSchema = z.object({
  sourceText: z.string().min(10).max(30000).refine((text) => text.trim().length >= 10, {
    message: "Kịch bản cần ít nhất 10 ký tự",
  }),
  settings: projectSettingsSchema.partial().default({}),
});

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  sourceText: z.string().trim().min(1).max(30000).optional(),
  hook: z.string().max(500).optional(),
  suggestedTitle: z.string().max(200).optional(),
  suggestedDescription: z.string().max(2000).optional(),
  settings: projectSettingsSchema.partial().optional(),
});

export const updateSceneSchema = sceneSchema
  .pick({
    narration: true,
    imagePrompt: true,
    subtitles: true,
  })
  .partial();

export const jobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum([
    "create_video",
    "storyboard",
    "generate_media",
    "regenerate_scene",
    "render_video",
  ]),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  progress: z.number().int().min(0).max(100),
  stage: z.string(),
  errorMessage: z.string().nullable(),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const estimateSchema = z.object({
  imageCount: z.number().int().min(0),
  narrationCharacters: z.number().int().min(0),
  transcriptionMinutes: z.number().min(0),
  estimatedUsd: z.number().min(0),
  note: z.string(),
});

export type Project = z.infer<typeof projectSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
