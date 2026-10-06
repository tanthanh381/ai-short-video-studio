import { describe, expect, it } from "vitest";
import { assTime, createAss, renderProject, videoEncoderPreset, videoSize } from "./render";
import { DEFAULT_PROJECT_SETTINGS, type Project } from "@studio/shared";

describe("render helpers", () => {
  it("chon dung kich thuoc preset", () => {
    expect(videoSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(videoSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });
  it("chon encoder nhanh theo preset nhung giu quality preset mac dinh", () => {
    expect(videoEncoderPreset("fast")).toBe("veryfast");
    expect(videoEncoderPreset("balanced")).toBe("faster");
    expect(videoEncoderPreset("quality")).toBe("medium");
    expect(videoEncoderPreset(undefined)).toBe("faster");
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
          videoPath: null,
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

  it("ho tro preset vuong va escape ASS an toan", () => {
    expect(videoSize("1:1")).toEqual({ width: 1080, height: 1080 });
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
      settings: { ...DEFAULT_PROJECT_SETTINGS, aspectRatio: "1:1" as const },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [
        {
          id: crypto.randomUUID(),
          order: 0,
          narration: "x",
          imagePrompt: "x",
          estimatedDurationMs: 1000,
          actualDurationMs: 1000,
          imagePath: "image",
          videoPath: null,
          audioPath: "audio",
          thumbnailUrl: null,
          mediaStatus: "ready" as const,
          errorMessage: null,
          subtitles: [
            {
              id: crypto.randomUUID(),
              startMs: 0,
              endMs: 900,
              text: "Dấu {ngoặc}\nđúng",
            },
          ],
        },
      ],
    } satisfies Project;
    const ass = createAss(project);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dấu \\{ngoặc\\}\\Nđúng");
  });

  it("tu choi render neu canh thieu media", async () => {
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
          narration: "x",
          imagePrompt: "x",
          estimatedDurationMs: 1000,
          actualDurationMs: null,
          imagePath: null,
          videoPath: null,
          audioPath: "audio",
          thumbnailUrl: null,
          mediaStatus: "pending" as const,
          errorMessage: null,
          subtitles: [],
        },
      ],
    } satisfies Project;
    await expect(
      renderProject(
        {
          FFMPEG_PATH: "ffmpeg",
          FFPROBE_PATH: "ffprobe",
          RENDER_TIMEOUT_MS: 1000,
        } as never,
        project,
        async () => new Uint8Array(),
        async () => undefined,
      ),
    ).rejects.toThrow("Cảnh 1 chưa có đủ media và giọng đọc");
  });
});
