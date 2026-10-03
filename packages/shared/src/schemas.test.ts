import { describe, expect, it } from "vitest";
import { createProjectSchema, subtitleCueSchema } from "./schemas";
import { DEFAULT_PROJECT_SETTINGS } from "./index";

describe("schema du an", () => {
  it("chap nhan du an hop le", () => {
    const parsed = createProjectSchema.parse({
      title: "Một phút sống chậm",
      sourceText: "Có những ngày chúng ta cần dừng lại để nghe chính mình.",
      inputMode: "idea",
      settings: DEFAULT_PROJECT_SETTINGS,
    });
    expect(parsed.settings.aspectRatio).toBe("9:16");
  });

  it("tu choi timestamp nguoc", () => {
    expect(() =>
      subtitleCueSchema.parse({
        id: crypto.randomUUID(),
        startMs: 2000,
        endMs: 1000,
        text: "Không hợp lệ",
      }),
    ).toThrow();
  });
});
