import { describe, expect, it, vi } from "vitest";
import { OllamaStoryboardAdapter } from "./ollama";

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
