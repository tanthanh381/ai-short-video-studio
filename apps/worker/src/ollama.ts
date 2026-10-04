import {
  buildStoryboardInstruction,
  parseStoryboard,
  storyboardJsonSchema,
  type StoryboardInput,
  type StoryboardProvider,
  type StoryboardResult,
} from "./providers";

type OllamaResponse = { response?: string; error?: string };

export class OllamaStoryboardAdapter implements StoryboardProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model = "qwen2.5:3b",
  ) {}

  async createStoryboard(input: StoryboardInput): Promise<StoryboardResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      signal: AbortSignal.timeout(240_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: storyboardJsonSchema,
        options: { temperature: 0.2, num_ctx: 8192, num_predict: 4096 },
        system: buildStoryboardInstruction(input),
        prompt: JSON.stringify({ title: input.title, storyContext: input.sourceText, lockedScenes: input.lockedScenes }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as OllamaResponse;
    if (!response.ok)
      throw new Error(`Ollama trả lỗi ${response.status}. Kiểm tra máy đang bật và model đã được cài`);
    if (!body.response) throw new Error("Ollama không trả về storyboard");
    return parseStoryboard(body.response);
  }
}
