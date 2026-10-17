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

export class AnthropicStoryboardAdapter implements StoryboardProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-haiku-4-5-20251001",
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
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
