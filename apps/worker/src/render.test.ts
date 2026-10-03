import { describe, expect, it } from "vitest";
import { assTime, createAss, videoSize } from "./render";
import { DEFAULT_PROJECT_SETTINGS, type Project } from "@studio/shared";

describe("render helpers", () => {
  it("chon dung kich thuoc preset", () => {
    expect(videoSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(videoSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });
  it("dinh dang thoi gian ASS", () => {
    expect(assTime(65_230)).toBe("0:01:05.23");
  });
  it("giu nguyen dau tieng Viet trong phu de", () => {
    const project = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      title: "t",
      sourceText: "x",
      inputMode: "idea",
      hook: "",
      suggestedTitle: "",
      suggestedDescription: "",
      status: "draft",
      settings: DEFAULT_PROJECT_SETTINGS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [
        {
          id: crypto.randomUUID(),
          order: 0,
          narration: "Xin chào Việt Nam",
          imagePrompt: "x",
          estimatedDurationMs: 3000,
          actualDurationMs: 3000,
          imagePath: "a",
          audioPath: "b",
          thumbnailUrl: null,
          mediaStatus: "ready",
          errorMessage: null,
          subtitles: [
            {
              id: crypto.randomUUID(),
              startMs: 0,
              endMs: 2000,
              text: "Xin chào Việt Nam",
            },
          ],
        },
      ],
    } satisfies Project;
    expect(createAss(project)).toContain("Xin chào Việt Nam");
    expect(createAss(project)).toContain("&H00FFFFFF");
  });
});
