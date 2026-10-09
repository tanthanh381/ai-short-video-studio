import { describe, expect, it } from "vitest";
import { assTime, createAss, karaokeText, mapWithConcurrency, renderProject, sceneMotion, videoEncoderPreset, videoSize } from "./render";
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
          annotationJson: null,
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
          annotationJson: null,
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
          annotationJson: null,
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

describe("karaoke captions", () => {
  it("splits the cue time over the words by length and keeps line breaks", () => {
    const text = karaokeText("Ăn khế\ntrả vàng", 2000);
    // 200 cs over letter weights 2/3/3/4; the last word takes the remainder so the cue ends exactly on time.
    expect(text).toBe("{\\k33}Ăn {\\k50}khế\\N{\\k50}trả {\\k67}vàng");
    const shares = [...text.matchAll(/\{\\k(\d+)\}/gu)].map((match) => Number(match[1]));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(200);
  });

  it("escapes braces inside words", () => {
    expect(karaokeText("a{b}", 500)).toBe("{\\k50}a\\{b\\}");
  });

  it("uses the highlight as primary colour only when karaoke captions are on", () => {
    const base = {
      id: crypto.randomUUID(), userId: crypto.randomUUID(), title: "t", sourceText: "x", inputMode: "idea", hook: "",
      suggestedTitle: "", suggestedDescription: "", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      scenes: [{
        id: crypto.randomUUID(), order: 0, narration: "Xin chào", imagePrompt: "x", estimatedDurationMs: 2000, actualDurationMs: 2000,
        imagePath: "a", videoPath: null, audioPath: "b", thumbnailUrl: null, mediaStatus: "ready", errorMessage: null, annotationJson: null,
        subtitles: [{ id: crypto.randomUUID(), startMs: 0, endMs: 2000, text: "Xin chào" }],
      }],
    } as const;
    const plain = createAss({ ...base, settings: DEFAULT_PROJECT_SETTINGS } as unknown as Project);
    const karaoke = createAss({ ...base, settings: { ...DEFAULT_PROJECT_SETTINGS, captionHighlight: true } } as unknown as Project);
    expect(plain).not.toContain("\\k");
    expect(karaoke).toContain("{\\k");
    expect(karaoke).toContain("Default,Noto Sans,65,&H004DE1FF,&H00FFFFFF"); // yellow highlight, white before spoken
  });
});

describe("scene motion", () => {
  it("keeps a short scene as one slow push-in", () => {
    expect(sceneMotion(5)).toBe("zoompan=z='min(max(zoom,pzoom)+0.00035,1.06)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1");
  });

  it("cuts a long scene in two framings halfway, so the picture changes within 7 s", () => {
    const filter = sceneMotion(9);
    expect(filter).toContain("if(lt(on,135)"); // 9 s * 30 fps / 2
    expect(filter).toContain("1.22+");
    expect(filter.endsWith(":d=1")).toBe(true);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps the scene order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([30, 5, 20, 1, 10], 3, async (delay, index) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running--;
      return index;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(3);
  });
});

