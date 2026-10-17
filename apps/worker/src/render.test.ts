import { describe, expect, it } from "vitest";
import { assTime, createAss, hookOverlayFilters, illustratedStoryTitleFilters, karaokeText, logoInputFilter, mapWithConcurrency, renderProject, sceneMotion, validateRenderedOutput, videoEncoderPreset, videoSize } from "./render";
import { DEFAULT_PROJECT_SETTINGS, PAPER_CAPTION_TOP, PLATFORM_SAFE, STORY_BAND, type Project } from "@studio/shared";
import { CARD, PAPER, SAFE } from "./card-layout";

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
  it("rejects a rendered file without the expected video and audio streams", () => {
    expect(() => validateRenderedOutput({ format: { duration: "4.2" }, streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
      { codec_type: "audio", codec_name: "aac" },
    ] }, { width: 1080, height: 1920 })).not.toThrow();
    expect(() => validateRenderedOutput({ format: { duration: "4.2" }, streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
    ] }, { width: 1080, height: 1920 })).toThrow(/audio/i);
    expect(() => validateRenderedOutput({ format: { duration: "4.2" }, streams: [
      { codec_type: "video", codec_name: "h264", width: 720, height: 1280 },
      { codec_type: "audio", codec_name: "aac" },
    ] }, { width: 1080, height: 1920 })).toThrow(/kích thước/i);
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
    // No explainer key points by default: no KeyPoint style or event.
    expect(createAss(project)).not.toContain("Style: KeyPoint");

    // Explainer theme: the per-scene key point is drawn, uppercased, in its own top-anchored style.
    const explainer = { ...project, settings: { ...project.settings, showKeyPoints: true, keyPoints: ["ý chính một"] } } satisfies Project;
    const ass = createAss(explainer);
    expect(ass).toContain("Style: KeyPoint");
    expect(ass).toContain(",KeyPoint,,0,0,0,,Ý CHÍNH MỘT");
    // A story card keeps its own title, so key points are suppressed there.
    const card = { ...explainer, settings: { ...explainer.settings, layoutTemplate: "story-card" as const, aspectRatio: "9:16" as const } } satisfies Project;
    expect(createAss(card)).not.toContain("Style: KeyPoint");
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

describe("sepia story card captions", () => {
  const project = (settings: Record<string, unknown>) => ({
    id: crypto.randomUUID(), userId: crypto.randomUUID(), title: "t", sourceText: "x", inputMode: "idea", hook: "", suggestedTitle: "",
    suggestedDescription: "", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    settings: { ...DEFAULT_PROJECT_SETTINGS, layoutTemplate: "story-card", cardTheme: "sepia", captionHighlight: true, ...settings },
    scenes: [{
      id: crypto.randomUUID(), order: 0, narration: "Xin chào", imagePrompt: "x", estimatedDurationMs: 2000, actualDurationMs: 2000,
      imagePath: "a", videoPath: null, audioPath: "b", thumbnailUrl: null, mediaStatus: "ready", errorMessage: null, annotationJson: null,
      subtitles: [{ id: crypto.randomUUID(), startMs: 0, endMs: 2000, text: "Xin chào các bạn" }],
    }],
  }) as unknown as Project;

  it("turns spoken words light green over pale unspoken ones, with a dark brown edge, 74 px, under the picture", () => {
    const style = createAss(project({})).split("\n").find((line) => line.startsWith("Style: Default"))!.split(",");
    expect(style[1]).toBe("Noto Sans");
    expect(style[2]).toBe("74");
    expect(style[3]).toBe("&H005AF4C8"); // spoken: #C8F45A as BGR
    expect(style[4]).toBe("&H00DDEBEE"); // unspoken: #EEEBDD
    expect(style[5]).toBe("&H0018242B"); // edge: #2B2418
    expect(style[16]).toBe("4");
    expect(style[18]).toBe("8");
    expect(style[21]).toBe("1362");
  });

  it("keeps the blue card's captions when the theme is blue", () => {
    const style = createAss(project({ cardTheme: "blue" })).split("\n").find((line) => line.startsWith("Style: Default"))!.split(",");
    expect(style[2]).toBe("58");
    expect(style[3]).toBe("&H004DE1FF");
  });
});

describe("blurred illustrated story card", () => {
  it("uses large white captions and a two-layer title glow", () => {
    const project = {
      id: crypto.randomUUID(), userId: crypto.randomUUID(), title: "t", sourceText: "x", inputMode: "idea", hook: "", suggestedTitle: "",
      suggestedDescription: "", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      settings: { ...DEFAULT_PROJECT_SETTINGS, layoutTemplate: "story-card", cardTheme: "blurred" }, scenes: [],
    } as unknown as Project;
    expect(createAss(project).split("\n").find((line) => line.startsWith("Style: Default"))?.split(",")[2]).toBe("78");
    expect(illustratedStoryTitleFilters(["/tmp/title.txt", "/tmp/title-2.txt"], ["HÃY THƯƠNG", "NHIỀU HƠN"])).toHaveLength(4);
  });
});

describe("scene motion", () => {
  it("cycles camera moves so consecutive stills never move the same way", () => {
    const moves = [0, 1, 2, 3, 4].map((index) => sceneMotion(5, index));
    expect(new Set(moves).size).toBe(5);
    expect(moves[0]).toBe("zoompan=z='1+0.06*(on/150)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1");
    expect(moves[2]).toContain("x='(iw-iw/zoom)*(on/150)'"); // pan left to right
    expect(sceneMotion(5, 5)).toBe(moves[0]);
  });

  it("cuts a long scene in two framings halfway, so the picture changes within 7 s", () => {
    const filter = sceneMotion(9, 2);
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

describe("hook title overlay", () => {
  it("draws each line from its text file, fades out by 3 s and fits long lines", () => {
    const filters = hookOverlayFilters(["/tmp/h0.txt", "/tmp/h1.txt"], ["VÌ SAO UỐNG NƯỚC", "GIÚP BẠN TỈNH TÁO"], 1080, 1920);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toContain("textfile=/tmp/h0.txt");
    expect(filters[1]).toContain("textfile=/tmp/h1.txt");
    expect(filters[0]).toContain("enable='lt(t,3)'");
    const size = Number(filters[0]!.match(/fontsize=(\d+)/u)![1]);
    expect(size).toBeLessThanOrEqual(92);
    expect(size * 0.62 * 17).toBeLessThanOrEqual(1080 * 0.88 + size); // the longest line fits the width
  });
});

describe("logo", () => {
  it("cuts a round logo saved on a square to a circle, and keeps an ordinary one as uploaded", () => {
    expect(logoInputFilter(151, false, 0.9)).toBe("scale=151:-1,format=rgba,colorchannelmixer=aa=0.9");
    const circle = logoInputFilter(151, true, 0.8);
    expect(circle).toMatch(/^crop='min\(iw,ih\)':'min\(iw,ih\)',scale=151:151,format=rgba,geq=/);
    expect(circle).toContain("clip(74.37-hypot(X+0.5-75.5,Y+0.5-75.5)+0.5,0,1)");
    expect(circle.endsWith("colorchannelmixer=aa=0.8")).toBe(true);
  });

  it("uses the same layout numbers as the shared logo placement", () => {
    expect(SAFE).toEqual(PLATFORM_SAFE);
    expect({ top: CARD.bandY, bottom: CARD.bandY + CARD.bandH }).toEqual(STORY_BAND);
    expect(PAPER.captionTop).toBe(PAPER_CAPTION_TOP);
  });
});
