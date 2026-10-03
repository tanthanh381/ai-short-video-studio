import { describe, expect, it } from "vitest";
import { buildStoryboardInstruction, parseStoryboard } from "./providers";

const input = {
  title: "Một câu chuyện ngắn",
  sourceText: "Nội dung tiếng Việt đủ dài để tạo storyboard.",
  inputMode: "full-script",
  rewrite: false,
  audience: "Người xem Việt Nam",
  style: "ke-chuyen",
  duration: 30,
  visualStyle: "Minh họa điện ảnh",
};

describe("storyboard provider contract", () => {
  it("giữ nguyên kịch bản hoàn chỉnh khi không cho phép viết lại", () => {
    expect(buildStoryboardInstruction(input)).toContain(
      "Giữ nguyên nội dung và câu chữ",
    );
  });

  it("chặn storyboard sai schema trước khi lưu", () => {
    expect(() =>
      parseStoryboard({
        hook: "Mở đầu",
        narration: "Nội dung",
        scenes: [
          {
            narration: "Chỉ có một cảnh",
            imagePrompt: "Một khung cảnh",
            estimatedDurationMs: 1_000,
          },
        ],
        suggestedTitle: "Tiêu đề",
        suggestedDescription: "Mô tả",
      }),
    ).toThrow();
  });

  it("nhận storyboard hợp lệ từ Claude hoặc OpenAI", () => {
    const result = parseStoryboard(
      JSON.stringify({
        hook: "Bạn đã bao giờ tự hỏi?",
        narration: "Cảnh một. Cảnh hai.",
        scenes: [
          {
            narration: "Cảnh một.",
            imagePrompt: "Buổi sáng ấm áp",
            estimatedDurationMs: 5_000,
          },
          {
            narration: "Cảnh hai.",
            imagePrompt: "Con đường phía trước",
            estimatedDurationMs: 5_000,
          },
        ],
        suggestedTitle: "Một câu chuyện",
        suggestedDescription: "Video kể chuyện ngắn.",
      }),
    );
    expect(result.scenes).toHaveLength(2);
  });
});
