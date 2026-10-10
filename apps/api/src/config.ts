import { z } from "zod";

const configSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(10),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  OLLAMA_BASE_URL: z.string().url().default("http://host.docker.internal:11434"),
  WORKER_HEALTH_URL: z.string().url().default("http://worker:8790"),
  PORT: z.coerce.number().int().positive().default(8787),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  DAILY_BUDGET_USD: z.coerce.number().min(0).default(3),
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(5).default(1),
  AI_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ANTHROPIC_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OLLAMA_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOCAL_MEDIA_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOCAL_MEDIA_BASE_URL: z.string().url().default("http://host.docker.internal:8765"),
  // Encrypts the account owner's own OpenAI / Claude keys at rest. Empty means "not set": keys cannot be saved.
  API_KEYS_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32, "API_KEYS_SECRET phải dài ít nhất 32 ký tự (dùng: openssl rand -base64 32)").optional(),
  ),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
  RENDER_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type AppConfig = z.infer<typeof configSchema>;
export function getConfig(): AppConfig {
  return configSchema.parse(process.env);
}
