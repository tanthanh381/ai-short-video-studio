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
            schema: input.lockedScenes
              ? lockedVisualStoryboardJsonSchema(input.lockedScenes.length)
              : storyboardJsonSchema,
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
}
