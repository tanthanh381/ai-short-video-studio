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

export class AnthropicStoryboardAdapter implements StoryboardProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-haiku-4-5-20251001",
  ) {
    this.client = new Anthropic({ apiKey });
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
        throw new Error(
          `Claude API trả lỗi ${error.status}${error.requestID ? ` (mã yêu cầu ${error.requestID})` : ""}`,
        );
      }
      throw error;
    }
  }
}
