/**
 * "Ý tưởng xu hướng": each morning (07:00 Asia/Ho_Chi_Minh) Claude researches current short-form trends with its web
 * search tool and writes video ideas + scripts for the channel's niches. Results are stored as JSON in Supabase
 * Storage (one file per user per day) — no database table. The same generation runs on the daily schedule and on the
 * manual "Làm mới" button. Claude is called over raw HTTP (the API has no Anthropic SDK), mirroring api-keys.ts.
 */
import {
  TREND_BUCKET,
  TREND_NICHES,
  trendDigestPath,
  trendDigestSchema,
  trendIdeasJsonHint,
  trendLatestPath,
  trendIdeaSchema,
  type TrendDigest,
} from "@studio/shared";
import type { AdminClient } from "./db";
import type { AppConfig } from "./config";
import type { KeyVaultService } from "./api-keys";

const VALID_NICHES = new Set(TREND_NICHES.map((niche) => niche.id));

/** yyyy-mm-dd and the hour (0-23) in Asia/Ho_Chi_Minh (UTC+7), without pulling in a tz library. */
export function vietnamNow(now = new Date()): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/** Pull the JSON object out of Claude's answer (it may wrap it in prose or a ```json fence). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Không tìm thấy JSON trong câu trả lời");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Validate and tidy the model's ideas: keep only well-formed ones, snap the niche to a known template. */
export function parseTrendIdeas(value: unknown): TrendDigest["ideas"] {
  const root = value as { ideas?: unknown };
  const list = Array.isArray(root?.ideas) ? root.ideas : Array.isArray(value) ? (value as unknown[]) : [];
  const ideas: TrendDigest["ideas"] = [];
  for (const raw of list) {
    const parsed = trendIdeaSchema.safeParse(raw);
    if (!parsed.success) continue;
    ideas.push({ ...parsed.data, niche: VALID_NICHES.has(parsed.data.niche) ? parsed.data.niche : "kien-thuc" });
    if (ideas.length >= 20) break;
  }
  return ideas;
}

type AnthropicBlock = { type: string; text?: string };
type AnthropicResponse = { stop_reason?: string; content?: AnthropicBlock[]; error?: { message?: string } };

function systemPrompt(count: number): string {
  const niches = TREND_NICHES.map((niche) => `${niche.id} (${niche.label})`).join(", ");
  return (
    "Bạn là chuyên gia nội dung video ngắn tiếng Việt cho TikTok, Reels và Shorts. " +
    "Nhiệm vụ: đề xuất ý tưởng video BÁM XU HƯỚNG HÔM NAY cho một kênh làm nội dung. " +
    "Hãy dùng công cụ tìm kiếm web để nắm chủ đề đang nóng, tin tức, dịp lễ/sự kiện sắp tới và các định dạng đang viral ở Việt Nam. " +
    `Tạo ${count} ý tưởng, trải đều trên các mảng kênh sau (trường "niche" phải là một id trong danh sách): ${niches}. ` +
    "Mỗi ý tưởng cần: tiêu đề, hook (câu mở đầu 3 giây), góc nhìn, vì sao bám xu hướng, dàn ý kịch bản ngắn (3-6 bước), 3-6 hashtag tiếng Việt, nền tảng phù hợp và thời lượng (giây). " +
    "Viết tiếng Việt tự nhiên, cụ thể, tránh chung chung và tránh giật tít sai sự thật. " +
    `Khi xong, trả về DUY NHẤT một JSON đúng dạng: ${trendIdeasJsonHint}`
  );
}

async function callClaude(apiKey: string, baseUrl: string, body: object): Promise<AnthropicResponse> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as AnthropicResponse;
  if (!response.ok) throw new Error(json.error?.message ?? `Claude trả về lỗi ${response.status}`);
  return json;
}

/**
 * Ask Claude (with web search) for today's ideas. Falls back to a no-tools call if the web-search tool or the model
 * is unavailable, so a theme page is still produced. Returns the validated digest.
 */
export async function generateTrendDigest(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  count?: number;
  now?: Date;
}): Promise<TrendDigest> {
  const { apiKey, baseUrl, model } = input;
  const count = input.count ?? 8;
  const { date } = vietnamNow(input.now);
  const system = systemPrompt(count);
  const userText = `Hôm nay là ${date}. Hãy đề xuất ý tưởng video bám xu hướng cho hôm nay.`;

  const run = async (withWebSearch: boolean): Promise<{ text: string; used: boolean }> => {
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: userText }];
    const base: Record<string, unknown> = { model, max_tokens: 8_000, system };
    if (withWebSearch) base.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }];
    let text = "";
    // Server tools can return stop_reason "pause_turn"; resend the accumulated turn until the model is done.
    for (let turn = 0; turn < 6; turn += 1) {
      const response = await callClaude(apiKey, baseUrl, { ...base, messages });
      for (const block of response.content ?? []) if (block.type === "text" && block.text) text += `${block.text}\n`;
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content ?? [] });
    }
    return { text, used: withWebSearch };
  };

  let result: { text: string; used: boolean };
  try {
    result = await run(true);
  } catch {
    // Web search unavailable on this key/model: still produce ideas from the model's own knowledge.
    result = await run(false);
  }
  const ideas = parseTrendIdeas(extractJsonObject(result.text));
  if (!ideas.length) throw new Error("Chưa tạo được ý tưởng. Hãy thử lại.");
  return { date, generatedAt: new Date().toISOString(), model, usedWebSearch: result.used, ideas };
}

export function createTrendService(db: AdminClient, config: AppConfig, vault: KeyVaultService) {
  let bucketReady = false;
  async function ensureBucket() {
    if (bucketReady) return;
    const { data } = await db.storage.getBucket(TREND_BUCKET);
    if (!data) {
      const { error } = await db.storage.createBucket(TREND_BUCKET, { public: false, fileSizeLimit: 262_144, allowedMimeTypes: ["application/json"] });
      if (error && !/already exists|duplicate/iu.test(error.message)) throw error;
    }
    bucketReady = true;
  }

  async function read(userId: string): Promise<TrendDigest | null> {
    const { data, error } = await db.storage.from(TREND_BUCKET).download(trendLatestPath(userId));
    if (error || !data) return null;
    const parsed = trendDigestSchema.safeParse(JSON.parse(await data.text()));
    return parsed.success ? parsed.data : null;
  }

  async function store(userId: string, digest: TrendDigest) {
    await ensureBucket();
    const body = JSON.stringify(digest);
    for (const path of [trendDigestPath(userId, digest.date), trendLatestPath(userId)]) {
      const { error } = await db.storage.from(TREND_BUCKET).upload(path, body, { contentType: "application/json", upsert: true, cacheControl: "0" });
      if (error) throw error;
    }
  }

  async function refresh(userId: string): Promise<TrendDigest> {
    const apiKey = await vault.open(userId, "anthropic");
    if (!apiKey) throw Object.assign(new Error("Chưa có khóa Claude. Hãy lưu khóa ở Cài đặt → Dịch vụ trả phí để dùng tính năng này."), { status: 400 });
    const digest = await generateTrendDigest({ apiKey, baseUrl: config.ANTHROPIC_BASE_URL, model: config.ANTHROPIC_TREND_MODEL });
    await store(userId, digest);
    return digest;
  }

  /** The 7am run: for each user who has a Claude key and no digest for today yet, generate and store one. */
  async function runDaily(now = new Date()) {
    const { date } = vietnamNow(now);
    const { data: folders } = await db.storage.from("app-secrets").list("", { limit: 1_000 });
    for (const folder of folders ?? []) {
      const userId = folder.name;
      if (!userId || userId.includes(".")) continue; // folders only
      try {
        const existing = await db.storage.from(TREND_BUCKET).download(trendDigestPath(userId, date));
        if (existing.data) continue; // already done today
        const apiKey = await vault.open(userId, "anthropic");
        if (!apiKey) continue;
        await store(userId, await generateTrendDigest({ apiKey, baseUrl: config.ANTHROPIC_BASE_URL, model: config.ANTHROPIC_TREND_MODEL, now }));
      } catch {
        // one user's failure must not stop the others
      }
    }
  }

  return { read, refresh, runDaily };
}
export type TrendService = ReturnType<typeof createTrendService>;

/** Minute-granularity scheduler: fires runDaily once when the Vietnam clock first reaches 07:0x. Call from index.ts. */
export function startDailyTrendScheduler(service: TrendService): () => void {
  let lastRunDate = "";
  const tick = () => {
    const { date, hour } = vietnamNow();
    if (hour === 7 && lastRunDate !== date) {
      lastRunDate = date;
      void service.runDaily().catch(() => undefined);
    }
  };
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
