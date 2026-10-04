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
  ANTHROPIC_TEXT_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  OLLAMA_BASE_URL: z.string().url().default("http://host.docker.internal:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  LOCAL_MEDIA_BASE_URL: z.string().url().default("http://host.docker.internal:8765"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2.5-sunburst"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  WORKER_POLL_MS: z.coerce.number().int().min(500).default(2000),
  RENDER_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(900_000),
  TEMP_RETENTION_HOURS: z.coerce.number().positive().default(24),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
});
export type WorkerConfig = z.infer<typeof schema>;
export function getConfig() {
  return schema.parse(process.env);
}
