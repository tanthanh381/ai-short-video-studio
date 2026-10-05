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
        model: input.model || this.model,
        stream: false,
        format: input.lockedScenes ? {
          type: "object", additionalProperties: false, required: ["scenes"],
          properties: { scenes: { type: "array", minItems: input.lockedScenes.length, maxItems: input.lockedScenes.length,
            items: { type: "object", additionalProperties: false, required: ["imagePrompt"],
              properties: { imagePrompt: { type: "string" } } } } },
        } : storyboardJsonSchema,
        options: { temperature: 0.2, num_ctx: 8192, num_predict: 4096 },
        system: buildStoryboardInstruction(input),
        prompt: JSON.stringify({ title: input.title, storyContext: input.sourceText, lockedScenes: input.lockedScenes }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as OllamaResponse;
    if (!response.ok)
      throw new Error(`Ollama trả lỗi ${response.status}. Kiểm tra máy đang bật và model đã được cài`);
    if (!body.response) throw new Error("Ollama không trả về storyboard");
    if (input.lockedScenes) {
      let generated: { scenes?: { imagePrompt?: unknown }[] };
      try { generated = JSON.parse(body.response); }
      catch { throw new Error("Ollama trả dữ liệu ảnh theo cảnh không hợp lệ; hãy thử lại"); }
      if (!generated || typeof generated !== "object" || !Array.isArray(generated.scenes))
        throw new Error("Ollama chưa tạo được prompt theo cảnh; hãy thử lại");
      // The text model only authors imagery, never script/hook/metadata.
      return parseStoryboard({
        hook: input.sourceText.trim().slice(0, 500), narration: input.sourceText,
        suggestedTitle: input.title, suggestedDescription: input.sourceText.slice(0, 2000),
        scenes: generated.scenes.map((scene, index) => ({
          narration: input.lockedScenes![index] ?? input.lockedScenes![0],
          imagePrompt: scene?.imagePrompt, estimatedDurationMs: 4000,
        })),
      });
    }
    return parseStoryboard(body.response);
  }
}
