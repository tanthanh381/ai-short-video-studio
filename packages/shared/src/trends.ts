/**
 * Daily trending-idea digest: Claude researches current short-form trends (via web search) each morning and writes
 * video ideas with ready-to-use scripts, tailored to the channel's niches. Stored as JSON in Supabase Storage (one
 * file per user per day) — no database table, so nothing here needs a migration. Pure types + schema so both the API
 * and the web app validate the same shape.
 */
import { z } from "zod";

export const TREND_BUCKET = "trend-ideas";
export const trendDigestPath = (userId: string, date: string) => `${userId}/${date}.json`;
export const trendLatestPath = (userId: string) => `${userId}/latest.json`;

/** The channel niches an idea can belong to; `id` matches a video template so "Tạo video" preselects it. */
export const TREND_NICHES: Array<{ id: string; label: string }> = [
  { id: "co-tich", label: "Truyện cổ tích" },
  { id: "quy-tac-co-nhan", label: "Quy tắc cổ nhân" },
  { id: "chua-lanh", label: "Triết lý · chữa lành" },
  { id: "kien-thuc", label: "Kiến thức · mẹo hay" },
  { id: "giai-thich", label: "Video giải thích" },
  { id: "tam-su", label: "Tâm sự · cảm xúc" },
  { id: "co-trang", label: "Cổ trang · kiếm hiệp" },
  { id: "dan-gian-viet-chibi", label: "Chibi dân gian Việt" },
];

export const trendIdeaSchema = z.object({
  /** A channel niche id from TREND_NICHES (falls back to "kien-thuc" if the model returns an unknown one). */
  niche: z.string().max(60),
  title: z.string().min(1).max(200),
  /** The opening line, said in the first ~3 seconds. */
  hook: z.string().min(1).max(300),
  /** The angle / why this take is fresh. */
  angle: z.string().max(500).default(""),
  /** Why it may ride a current trend (a date, event, season, running topic). */
  whyTrending: z.string().max(500).default(""),
  /** A short beat-by-beat script outline to drop into the creator. */
  scriptOutline: z.array(z.string().max(500)).max(12).default([]),
  hashtags: z.array(z.string().max(60)).max(10).default([]),
  /** Where it fits best, free text: "TikTok", "Reels", "Shorts", "TikTok · Reels". */
  platform: z.string().max(80).default("TikTok"),
  durationSec: z.number().int().min(15).max(180).default(45),
});
export type TrendIdea = z.infer<typeof trendIdeaSchema>;

export const trendDigestSchema = z.object({
  /** yyyy-mm-dd in Asia/Ho_Chi_Minh. */
  date: z.string().max(10),
  generatedAt: z.string(),
  model: z.string().max(80),
  usedWebSearch: z.boolean().default(false),
  ideas: z.array(trendIdeaSchema).max(20).default([]),
});
export type TrendDigest = z.infer<typeof trendDigestSchema>;

/** The JSON shape Claude is asked to return (parsed and re-validated with the zod schema above). */
export const trendIdeasJsonHint = `{
  "ideas": [
    {
      "niche": "<một trong các id niche được cung cấp>",
      "title": "tiêu đề video ngắn gọn, hấp dẫn",
      "hook": "câu mở đầu nói trong 3 giây đầu, gây tò mò",
      "angle": "góc nhìn mới / điều khiến video khác biệt",
      "whyTrending": "vì sao bám xu hướng hiện tại (sự kiện, dịp, chủ đề đang nóng)",
      "scriptOutline": ["mở đầu", "diễn biến", "cao trào", "chốt + kêu gọi"],
      "hashtags": ["#...", "#..."],
      "platform": "TikTok · Reels",
      "durationSec": 45
    }
  ]
}`;
