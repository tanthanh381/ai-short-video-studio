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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: storyboardJsonSchema,
        options: { temperature: 0.2 },
        system: buildStoryboardInstruction(input),
        prompt: `Tên video: ${input.title}\nNội dung:\n${input.sourceText}`,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as OllamaResponse;
    if (!response.ok)
      throw new Error(`Ollama trả lỗi ${response.status}: ${body.error ?? "không rõ nguyên nhân"}`);
    if (!body.response) throw new Error("Ollama không trả về storyboard");
    return parseStoryboard(body.response);
  }
}
