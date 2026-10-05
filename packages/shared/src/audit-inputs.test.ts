import { describe, expect, it } from "vitest";
import { createVideoSchema } from "./schemas";

describe("audit input matrix - validation only, not generated speech quality", () => {
  it.each([
    ["short sentence", "Một ngày mới."],
    ["long paragraph", "Một đoạn văn để kiểm thử. ".repeat(100)],
    ["complete script", "Mở đầu gây chú ý.\nCâu chuyện phát triển.\nKết thúc đáng nhớ."],
    ["Vietnamese", "Đừng quên những điều tử tế quanh mình."],
    ["English", "A small change today can become a useful habit."],
    ["mixed language", "Hôm nay tôi thử deep work trong ba mươi phút."],
    ["ambiguous input", "Hãy làm cái đó thật hay."],
  ])("accepts and preserves %s", (_name, sourceText) => {
    expect(createVideoSchema.parse({ sourceText }).sourceText).toBe(sourceText);
  });
  it.each(["", "   ".repeat(20), "abc", "x".repeat(30001), null, 123, {}])("rejects malformed input %#", (sourceText) => {
    expect(createVideoSchema.safeParse({ sourceText }).success).toBe(false);
  });
});
