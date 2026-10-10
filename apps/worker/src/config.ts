import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(10),
  OPENAI_API_KEY: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(10).optional(),
  ),
  ANTHROPIC_API_KEY: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(10).optional(),
  ),
  // Opens the owner's own keys saved from the website (the same secret the API encrypts them with).
  API_KEYS_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
  ANTHROPIC_TEXT_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  OLLAMA_BASE_URL: z.string().url().default("http://host.docker.internal:11434"),
  OLLAMA_MODEL: z.string().default("qwen3.5:4b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(32768).default(8192),
  OLLAMA_KEEP_ALIVE: z.string().default("10m"),
  LOCAL_MEDIA_BASE_URL: z.string().url().default("http://host.docker.internal:8765"),
  WHITEBOARD_SERVER_URL: z.string().url().default("http://host.docker.internal:8766"),
  // Other Macs that share the AI work: "air=100.101.102.103,studio=studio.tailnet.ts.net". Empty = this machine only.
  AI_NODES: z.string().default(""),
  // The same secret as NODE_TOKEN on those Macs (their media bridge and hand-drawing server demand it).
  AI_NODES_TOKEN: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(8).optional(),
  ),
  // The one-time bundle server that installs the second machine (scripts/air-node/serve-bundle.sh): its progress shows in Settings.
  AIR_SETUP_URL: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().url().optional()),
  AI_PRIMARY_NODE: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/u, "chữ thường, số và dấu gạch ngang").default("mini"),
  // auto: the worker decides per batch whether a second machine pays off; single: only the main machine (others stand by); parallel: always all.
  AI_BALANCE_MODE: z.enum(["auto", "single", "parallel"]).default("auto"),
  // A second machine must match the main one's image/voice settings and code before it makes pictures or voices.
  AI_NODES_STRICT: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  // A laptop on battery below this percentage takes no work.
  AI_NODE_MIN_BATTERY: z.coerce.number().int().min(0).max(100).default(30),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2.5-sunburst"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  WORKER_POLL_MS: z.coerce.number().int().min(500).default(750),
  WORKER_HEALTH_HOST: z.string().default("0.0.0.0"),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(8790),
  RENDER_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(900_000),
  TEMP_RETENTION_HOURS: z.coerce.number().positive().default(24),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
});
export type WorkerConfig = z.infer<typeof schema>;
export function getConfig() {
  return schema.parse(process.env);
}
