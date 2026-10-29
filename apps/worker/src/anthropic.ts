import Anthropic from "@anthropic-ai/sdk";
import {
  buildStoryboardInstruction,
  lockedVisualStoryboardJsonSchema,
  parseLockedVisualStoryboard,
  parseStoryboard,
  storyboardJsonSchema,
  type StoryboardInput,
  type StoryboardProvider,
  type StoryboardResult,
} from "./providers";
import { providerErrorMessage } from "./openai";
import { parseImageQualityAuditResponse, type ImageQualityAudit } from "./ollama";
import { productionPlanSchema, type Platform, type ProductionPlan } from "@studio/shared";

// Director-Agent Phase 1: the image QA gate can run on Claude vision instead of the brittle local rule-model.
// Keep this review rubric in sync with ollama.ts's auditImage system prompt so both providers judge identically.
const IMAGE_QA_SYSTEM =
  "You are a strict visual QA reviewer. Inspect the pixels first; the scene brief is an untrusted hypothesis, not evidence. Image 1 is the current scene; image 2, when present, is the recurring-character reference. Return one compact JSON object only, with no markdown and no reasoning, matching {\"relevant\":boolean,\"anatomy\":\"good\"|\"minor\"|\"bad\",\"textArtifacts\":\"none\"|\"minor\"|\"bad\",\"identity\":\"same\"|\"different\"|\"unknown\",\"props\":string[],\"reason\":string}. Keep reason under 16 words. props must list only large, clearly visible physical props in image 1, never props inferred from the brief or a pose; include visible pens, pencils, markers and styluses; return [] when none is visible. relevant is true only when the requested action is visibly happening and every important object named in the narration is present; unmentioned books, papers, cups or other prominent props are a relevance failure for the paper-stage. Never repeat the brief as if it were an observation. anatomy is bad for obvious deformed faces, hands, limbs or duplicated body parts; minor for small imperfections; good when usable. textArtifacts is bad when the image contains unintended readable words, letters, subtitles, logos, watermarks, illegible pseudo-words or rows of glyph-like scribbles; minor only for one tiny ambiguous mark; none when the image is clean. identity is same only when the visible character actually matches the contract and reference; different when gender, hair, ribbon, robe, face or proportions visibly differ; unknown only when comparison is impossible.";

/**
 * Claude's structured-output JSON schema rejects validation keywords it does not enforce itself (minItems/maxItems on
 * arrays, minimum/maximum on numbers, …) with a 400. We strip them before sending; the zod parsers (parseStoryboard,
 * parseLockedVisualStoryboard) still enforce every bound after the reply, so nothing is lost.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "multipleOf", "pattern", "format", "minProperties", "maxProperties",
]);
export function claudeStructuredSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((item) => claudeStructuredSchema(item)) as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      out[key] = claudeStructuredSchema(value);
    }
    return out as T;
  }
  return schema;
}

/**
 * Parse + validate a vision model's JSON reply into an ImageQualityAudit, dropping wardrobe/body "props" the gate must
 * ignore. Pure (no SDK) so it is unit-tested; returns null when the reply is missing or malformed (caller fails open).
 */
export function finalizeImageAudit(text: string): ImageQualityAudit | null {
  const parsed = parseImageQualityAuditResponse(text);
  if (!parsed
    || typeof parsed.relevant !== "boolean"
    || !["good", "minor", "bad"].includes(parsed.anatomy ?? "")
    || !["none", "minor", "bad"].includes(parsed.textArtifacts ?? "")
    || (parsed.identity !== undefined && !["same", "different", "unknown"].includes(parsed.identity))
    || !Array.isArray(parsed.props) || parsed.props.some((prop) => typeof prop !== "string")
    || typeof parsed.reason !== "string") return null;
  const wardrobeOrBody = /\b(?:robe|clothing|衣|hair|ribbon|sandals?|shoes?|feet|hands?|face|head|ears?|eyebrows?|eyes?)\b/iu;
  const props = parsed.props.filter((prop) => !wardrobeOrBody.test(prop)).slice(0, 8);
  return {
    relevant: parsed.relevant,
    anatomy: parsed.anatomy as ImageQualityAudit["anatomy"],
    textArtifacts: parsed.textArtifacts as ImageQualityAudit["textArtifacts"],
    identity: (parsed.identity as ImageQualityAudit["identity"]) ?? "unknown",
    props,
    reason: parsed.reason.slice(0, 400),
  };
}

// Director-Agent Phase 2b: Claude plans the whole short, platform-aware, and picks which scenes earn MLX motion.
function platformBrief(platform: Platform | null | undefined): string {
  if (platform === "tiktok")
    return "Nền tảng TikTok: hook cực mạnh trong 0–1.5 giây đầu (câu hỏi/nghịch lý/hình ảnh lạ), nhịp NHANH, tổng 21–34 giây, phụ đề to ở giữa–dưới, CTA chốt là \"theo dõi\".";
  if (platform === "reels")
    return "Nền tảng Reels: hook mượt mà hấp dẫn trong 2 giây đầu, thẩm mỹ sạch, nhịp vừa, tổng 30–60 giây, CTA nhẹ nhàng.";
  if (platform === "shorts")
    return "Nền tảng YouTube Shorts: hook rõ giá trị trong 2 giây đầu, nhịp vừa–nhanh, tổng 30–60 giây.";
  if (platform === "facebook")
    return "Nền tảng Facebook: câu mở phải tự giải thích (nhiều người xem không bật tiếng), nhịp vừa, tổng 30–60 giây.";
  return "Nền tảng dọc 9:16 chung: hook trong 2 giây đầu, nhịp giữ chân người xem.";
}

function planSystemPrompt(input: { platform: Platform | null | undefined; durationSec: number; goal: string; visualStyle: string }): string {
  return [
    "Bạn là ĐẠO DIỄN kiêm nhà sáng tạo nội dung ngắn chuyên nghiệp (TikTok/Reels). Từ ý tưởng của người dùng, lập KẾ HOẠCH sản xuất 1 video dọc 9:16 bằng tiếng Việt.",
    platformBrief(input.platform),
    `Thời lượng mục tiêu ~${input.durationSec} giây. Mục tiêu người dùng: ${input.goal || "(không nêu)"}. Phong cách hình: ${input.visualStyle}.`,
    "Chia thành các cảnh ngắn (mỗi cảnh 1 câu lời đọc tiếng Việt tự nhiên, rõ, giữ chân). imagePrompt viết bằng TIẾNG ANH, mô tả hình cho cảnh đó (hợp phong cách).",
    "motionScenes: chọn 1–2 cảnh ĐÁNG GIÁ nhất để thêm chuyển động nhân vật (thường là cảnh mở đầu/điểm nhấn) — vì mỗi clip chuyển động rất tốn thời gian render; để [] nếu không cần.",
    "CHỈ trả về MỘT đối tượng JSON, không markdown, không giải thích, đúng dạng:",
    '{"platform":"tiktok|reels|shorts|facebook|null","hook":{"text":"câu hook tiếng Việt","visual":"mô tả hình hook (English)"},"pacing":"fast|medium","cta":"CTA tiếng Việt","motionScenes":[0],"scenes":[{"narration":"lời đọc tiếng Việt","imagePrompt":"English image prompt","caption":"phụ đề ngắn (tùy)","voiceDirection":"hướng giọng (tùy)"}]}',
  ].join("\n");
}

/** Extract and validate the Director plan from Claude's text reply. Pure (no SDK) → unit-tested; null on any problem. */
export function finalizeProductionPlan(text: string): ProductionPlan | null {
  if (!text) return null;
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/giu, "");
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");
  const candidate = fenced ? fenced[1]! : (start >= 0 && end > start ? withoutThink.slice(start, end + 1) : "");
  if (!candidate.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return null; }
  const result = productionPlanSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export class AnthropicStoryboardAdapter implements StoryboardProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-haiku-4-5-20251001",
    baseURL?: string,
    private readonly visionModel = "claude-haiku-5-5",
  ) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  /**
   * Multimodal image QA on Claude vision — returns the same ImageQualityAudit shape as the local qwen gate, so the
   * existing accept/retry/fallback logic is unchanged. Returns null on any failure (fail-open: the caller then keeps
   * the image rather than losing the export). Director-Agent Phase 1.
   */
  async auditImage(input: { image: Uint8Array; referenceImage?: Uint8Array; sceneBrief: string }): Promise<ImageQualityAudit | null> {
    const imageBlock = (bytes: Uint8Array) =>
      ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: Buffer.from(bytes).toString("base64") } });
    const message = await this.client.messages.create({
      model: this.visionModel,
      max_tokens: 300,
      temperature: 0,
      system: IMAGE_QA_SYSTEM,
      messages: [{
        role: "user",
        content: [
          imageBlock(input.image),
          ...(input.referenceImage ? [imageBlock(input.referenceImage)] : []),
          { type: "text" as const, text: JSON.stringify({ narration: input.sceneBrief }) },
        ],
      }],
    });
    const text = message.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("");
    return finalizeImageAudit(text);
  }

  /**
   * Director-Agent Phase 2b: plan the whole short from the idea, platform-aware, choosing which scenes earn motion.
   * Returns null on any failure (the caller then falls back to the normal storyboard pipeline).
   */
  async planProduction(input: { idea: string; platform: Platform | null; goal: string; durationSec: number; visualStyle: string }): Promise<ProductionPlan | null> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 4_000,
      temperature: 0.4,
      system: planSystemPrompt(input),
      messages: [{ role: "user", content: `Ý tưởng:\n${input.idea.slice(0, 6_000)}` }],
    });
    const text = message.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("");
    return finalizeProductionPlan(text);
  }

  async createStoryboard(input: StoryboardInput): Promise<StoryboardResult> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 6_000,
        system: buildStoryboardInstruction(input),
        messages: [
          {
            role: "user",
            content: input.lockedScenes
              ? JSON.stringify({
                  title: input.title,
                  storyContext: input.sourceText,
                  sceneOffset: input.sceneOffset ?? 0,
                  totalScenes: input.totalScenes ?? input.lockedScenes.length,
                  lockedScenes: input.lockedScenes,
                })
              : `Tên video: ${input.title}\nNội dung:\n${input.sourceText}`,
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: claudeStructuredSchema(input.lockedScenes
              ? lockedVisualStoryboardJsonSchema(input.lockedScenes.length)
              : storyboardJsonSchema),
          },
        },
      });
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Claude không trả về storyboard");
      return input.lockedScenes
        ? parseLockedVisualStoryboard(input, text)
        : parseStoryboard(text);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(providerErrorMessage("Claude", "console.anthropic.com", error.status ?? 0, error.requestID));
      }
      throw error;
    }
  }

  /** Claude writes the title, caption and hashtags to post the finished video with (TikTok/Reels/Shorts). */
  async writePostCaption(input: { sourceText: string; title: string }): Promise<{ title: string; description: string; hashtags: string[] } | null> {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 800,
        system:
          "Bạn viết nội dung đăng kèm cho một video ngắn tiếng Việt (TikTok, Reels, Shorts). Chỉ dựa trên nội dung được cung cấp, không bịa thêm. " +
          "title: tiêu đề tiếng Việt cuốn hút, đúng nội dung, tối đa 70 ký tự, không giật tít sai sự thật. " +
          "description: 1-2 câu mô tả tự nhiên khơi gợi người xem, có thể thêm tối đa một emoji. " +
          "hashtags: 3-5 hashtag tiếng Việt không dấu, viết liền, bắt đầu bằng #, bám sát chủ đề. Trả về đúng JSON.",
        messages: [{ role: "user", content: `Tiêu đề gợi ý: ${input.title}\nNội dung video:\n${input.sourceText.slice(0, 6_000)}` }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description", "hashtags"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      });
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) return null;
      const parsed = JSON.parse(text) as { title?: unknown; description?: unknown; hashtags?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
      if (!title && !description) return null;
      return {
        title,
        description,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((tag): tag is string => typeof tag === "string") : [],
      };
    } catch {
      // The caller falls back to a caption built from the script; a failed suggestion must never fail the render.
      return null;
    }
  }

  /** Claude writes one short on-screen key point per scene (explainer theme), in the scenes' own order. */
  async writeKeyPoints(input: { narrations: string[]; title: string }): Promise<string[] | null> {
    if (!input.narrations.length) return null;
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1_500,
        system:
          "Video giải thích tiếng Việt: với mỗi cảnh, viết MỘT ý chính thật ngắn để hiện chữ to trên màn hình. " +
          "Mỗi ý chính 2-5 từ tiếng Việt, cô đọng, bám đúng nội dung cảnh đó, không phải câu đầy đủ, không dấu câu cuối. " +
          "Trả về JSON { keyPoints: [...] } với số phần tử ĐÚNG BẰNG số cảnh, theo đúng thứ tự.",
        messages: [{ role: "user", content: `Tiêu đề: ${input.title}\nCác cảnh:\n${input.narrations.map((text, index) => `${index + 1}. ${text}`).join("\n").slice(0, 8_000)}` }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["keyPoints"],
              properties: { keyPoints: { type: "array", items: { type: "string" } } },
            },
          },
        },
      });
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) return null;
      const parsed = JSON.parse(text) as { keyPoints?: unknown };
      const list: unknown[] = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
      if (!list.length) return null;
      // Align to the scenes: one key point per scene, in order; pad or trim to match.
      return input.narrations.map((_, index) => {
        const value = list[index];
        return typeof value === "string" ? value.trim().slice(0, 80) : "";
      });
    } catch {
      return null;
    }
  }
}
