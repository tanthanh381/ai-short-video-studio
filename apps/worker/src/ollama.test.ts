import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaStoryboardAdapter } from "./ollama";
import type { StoryboardInput } from "./providers";

afterEach(() => vi.unstubAllGlobals());

describe("OllamaStoryboardAdapter", () => {
  it("gọi Ollama với JSON schema và parse storyboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            response: JSON.stringify({
              hook: "Bạn có biết?",
              narration: "Nội dung kiểm thử.",
              scenes: [
                { narration: "Cảnh một.", imagePrompt: "Minh họa một", estimatedDurationMs: 3000 },
                { narration: "Cảnh hai.", imagePrompt: "Minh họa hai", estimatedDurationMs: 3000 },
              ],
              suggestedTitle: "Video kiểm thử",
              suggestedDescription: "Mô tả kiểm thử",
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const result = await new OllamaStoryboardAdapter("http://localhost:11434", "qwen2.5:3b").createStoryboard({
      title: "Kiểm thử",
      sourceText: "Nội dung tiếng Việt đủ dài để kiểm thử Ollama.",
      inputMode: "idea",
      rewrite: false,
      audience: "Người xem Việt Nam",
      style: "ke-chuyen",
      duration: 30,
      visualStyle: "Minh họa điện ảnh",
    });
    expect(result.scenes).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

const lockedInput: StoryboardInput = {
  title: "Ba điều nên nhớ",
  sourceText: "  Bình tĩnh trước một tin nhắn lạ.\nKiểm tra kỹ đường dẫn. Không chia sẻ mật khẩu.  ",
  inputMode: "full-script",
  rewrite: false,
  audience: "Người xem Việt Nam",
  style: "ke-chuyen",
  duration: 30,
  visualStyle: "Minh họa điện ảnh",
  lockedScenes: [
    "  Bình tĩnh trước một tin nhắn lạ.\n",
    "Kiểm tra kỹ đường dẫn. ",
    "Không chia sẻ mật khẩu.  ",
  ],
};

function stubLocalResponse(response: string, status = 200) {
  const request = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ response }),
    { status, headers: { "content-type": "application/json" } },
  ));
  vi.stubGlobal("fetch", request);
  return request;
}

describe("Ollama locked visual-prompt response", () => {
  it("accepts only visual prompts without requiring model-authored hook or narration", async () => {
    const prompts = [
      "A person looking calmly at a smartphone",
      "A person examining a suspicious link on a laptop",
      "A person protecting a password from a stranger",
    ];
    stubLocalResponse(JSON.stringify({ scenes: prompts.map((imagePrompt) => ({ imagePrompt })) }));
    const result = await new OllamaStoryboardAdapter("http://localhost:11434").createStoryboard(lockedInput);
    expect(result.scenes.map((scene) => scene.imagePrompt)).toEqual(prompts);
    expect(result.scenes.map((scene) => scene.narration)).toEqual(lockedInput.lockedScenes);
    expect(result.scenes.map((scene) => scene.narration).join("")).toBe(lockedInput.sourceText);
    expect(result.narration).toBe(lockedInput.sourceText);
    expect(result.suggestedTitle).toBe(lockedInput.title);
    expect(result.suggestedDescription).toBe(lockedInput.sourceText);
    expect(result.hook).toBe(lockedInput.sourceText.trim());
  });

  it("locks schema to the exact scene count and calls only the configured local endpoint", async () => {
    const request = stubLocalResponse(JSON.stringify({
      scenes: lockedInput.lockedScenes!.map(() => ({ imagePrompt: "A person reading a book" })),
    }));
    await new OllamaStoryboardAdapter("http://127.0.0.1:11434/", "qwen2.5:3b").createStoryboard(lockedInput);
    expect(request).toHaveBeenCalledTimes(1);
    const [endpoint, options] = request.mock.calls[0]! as [string, RequestInit];
    expect(endpoint).toBe("http://127.0.0.1:11434/api/generate");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "content-type": "application/json" });
    const payload = JSON.parse(options.body as string);
    expect(payload.model).toBe("qwen2.5:3b");
    expect(payload.stream).toBe(false);
    expect(payload.options).toEqual(expect.objectContaining({ top_p: 0.88, repeat_penalty: 1.08, num_ctx: 8192 }));
    expect(payload.format.required).toEqual(["scenes"]);
    expect(Object.keys(payload.format.properties)).toEqual(["scenes"]);
    expect(payload.format.properties.scenes).toEqual(expect.objectContaining({
      type: "array",
      minItems: lockedInput.lockedScenes!.length,
      maxItems: lockedInput.lockedScenes!.length,
    }));
    expect(payload.format.properties.scenes.items.required).toEqual(["imagePrompt"]);
    expect(Object.keys(payload.format.properties.scenes.items.properties)).toEqual(["imagePrompt"]);
    expect(JSON.parse(payload.prompt)).toEqual({
      title: lockedInput.title,
      storyContext: lockedInput.sourceText,
      lockedScenes: lockedInput.lockedScenes,
    });
  });

  it("ignores invented metadata and narration in a visual-prompt response", async () => {
    stubLocalResponse(JSON.stringify({
      hook: "",
      narration: "Nội dung hoàn toàn khác",
      suggestedTitle: "Tiêu đề tự bịa",
      suggestedDescription: "Mô tả tự bịa",
      scenes: lockedInput.lockedScenes!.map(() => ({
        narration: "Lời đọc sai so với nguồn",
        imagePrompt: "A person reading a book beside a window",
      })),
    }));
    const result = await new OllamaStoryboardAdapter("http://localhost:11434").createStoryboard(lockedInput);
    expect(result.narration).toBe(lockedInput.sourceText);
    expect(result.scenes.map((scene) => scene.narration).join("")).toBe(lockedInput.sourceText);
    expect(result.suggestedTitle).toBe(lockedInput.title);
    expect(result.hook).not.toBe("");
  });

  it.each([
    "{ malformed JSON",
    "{}",
    "null",
    "[]",
    '{"scenes":null}',
    '{"scenes":{}}',
    '{"scenes":[null]}',
    '{"scenes":[{"imagePrompt":""}]}',
  ])("returns a Vietnamese error for malformed visual-prompt output: %s", async (response) => {
    stubLocalResponse(response);
    await expect(new OllamaStoryboardAdapter("http://localhost:11434").createStoryboard(lockedInput))
      .rejects.toThrow(/(Ollama|AI).*(không hợp lệ|chưa tạo được)/);
  });

  it("returns a Vietnamese service error without leaking the local response body", async () => {
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "private internal provider diagnostic" }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", request);
    await expect(new OllamaStoryboardAdapter("http://localhost:11434").createStoryboard(lockedInput))
      .rejects.toThrow("Ollama trả lỗi 503. Kiểm tra máy đang bật và model đã được cài");
  });

  it("dùng model Ollama do dự án chọn thay cho model mặc định", async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ response: JSON.stringify({
      hook: "H", narration: "N", scenes: [{ narration: "Cảnh.", imagePrompt: "P", estimatedDurationMs: 3000 }],
      suggestedTitle: "T", suggestedDescription: "D" }) })));
    vi.stubGlobal("fetch", mock);
    const input: StoryboardInput = { title: "t", sourceText: "Nội dung đủ dài để kiểm thử.", inputMode: "idea", rewrite: false,
      audience: "a", style: "ke-chuyen", duration: 30, visualStyle: "v" };
    const adapter = new OllamaStoryboardAdapter("http://localhost:11434", "qwen2.5:3b");
    await adapter.createStoryboard({ ...input, model: "llama3.2:3b" });
    await adapter.createStoryboard({ ...input, model: null });
    const models = (mock.mock.calls as unknown as Array<[string, { body: string }]>).map((call) => JSON.parse(call[1].body).model);
    expect(models).toEqual(["llama3.2:3b", "qwen2.5:3b"]);
  });
});
