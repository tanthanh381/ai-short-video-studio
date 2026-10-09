import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, type Project } from "@studio/shared";
import { CARD, brandInitials, castForScript, cardFooterLines, cardTitleFontSize, fallbackCardTitle, splitCardTitle, usesStoryCard } from "./card-layout";
import { createAss } from "./render";
import { buildAmbientMusicArgs, buildAudioMixFilter } from "./render-quality";

describe("story-card title", () => {
  it("upper-cases Vietnamese and keeps a short title on one line", () => {
    expect(splitCardTitle("Buông bỏ nhẹ lòng")).toEqual(["BUÔNG BỎ NHẸ LÒNG"]);
  });

  it("splits a long title into two balanced lines and never three", () => {
    const lines = splitCardTitle("phúc đức của con bắt đầu từ mẹ");
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe("PHÚC ĐỨC CỦA CON BẮT ĐẦU TỪ MẸ");
    expect(Math.abs(lines[0]!.length - lines[1]!.length)).toBeLessThanOrEqual(6);
    expect(splitCardTitle("một hai ba bốn năm sáu bảy tám chín mười mười một mười hai").length).toBeLessThanOrEqual(2);
  });

  it("falls back to the hook sentence when it is banner-sized, else to the first clause", () => {
    expect(fallbackCardTitle("Bạn có tin rằng mẹ giữ bình yên? Mẹ không nói nhiều, nhưng mỗi việc mẹ làm đều dạy ta.")).toBe("BẠN CÓ TIN RẰNG MẸ GIỮ BÌNH YÊN");
    expect(fallbackCardTitle("Có những người đi qua đời ta, chỉ để dạy ta một bài học. Đừng níu giữ.")).toBe("CÓ NHỮNG NGƯỜI ĐI QUA ĐỜI TA");
    expect(fallbackCardTitle("Một hai ba bốn năm sáu bảy tám chín mười")).toBe("MỘT HAI BA BỐN NĂM SÁU BẢY TÁM CHÍN");
  });

  it("shrinks the font for long lines but never below a readable size", () => {
    expect(cardTitleFontSize(["NGẮN"])).toBe(CARD.titleSize);
    expect(cardTitleFontSize(["MỘT DÒNG RẤT RẤT DÀI VƯỢT QUÁ KHUNG HÌNH"])).toBeLessThan(CARD.titleSize);
    expect(cardTitleFontSize(["X".repeat(200)])).toBe(46);
  });

  it("writes the channel footer only when a brand is set", () => {
    expect(cardFooterLines("  ")).toEqual([]);
    expect(cardFooterLines("Kênh Của Tôi")).toEqual(["Bản quyền thuộc về:", "Kênh Của Tôi"]);
  });

  it("builds the default badge from up to two initials of the channel name", () => {
    expect(brandInitials("Góc Nhỏ Bình Yên")).toBe("GN");
    expect(brandInitials("đời")).toBe("Đ");
    expect(brandInitials("   ")).toBe("");
  });

  it("applies only to 9:16 videos", () => {
    expect(usesStoryCard({ layoutTemplate: "story-card", aspectRatio: "9:16" })).toBe(true);
    expect(usesStoryCard({ layoutTemplate: "story-card", aspectRatio: "16:9" })).toBe(false);
    expect(usesStoryCard({ layoutTemplate: "full-bleed", aspectRatio: "9:16" })).toBe(false);
  });
});

describe("story-card captions and audio", () => {
  const project = (layoutTemplate: "full-bleed" | "story-card") => ({
    id: crypto.randomUUID(), userId: crypto.randomUUID(), title: "t", sourceText: "s", inputMode: "full-script",
    hook: "", suggestedTitle: "", suggestedDescription: "", status: "draft",
    settings: { ...DEFAULT_PROJECT_SETTINGS, layoutTemplate },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    scenes: [{
      id: crypto.randomUUID(), order: 0, narration: "Xin chào", imagePrompt: "x", estimatedDurationMs: 3000, actualDurationMs: 3000,
      imagePath: "a", videoPath: null, audioPath: "b", thumbnailUrl: null, mediaStatus: "ready", errorMessage: null, annotationJson: null,
      subtitles: [{ id: crypto.randomUUID(), startMs: 0, endMs: 2000, text: "Xin chào" }],
    }],
  }) as unknown as Project;

  it("places captions top-anchored under the picture band without a box", () => {
    const card = createAss(project("story-card"));
    expect(card).toMatch(new RegExp(`,1,2,0,8,\\d+,\\d+,${CARD.subtitleTop},1`)); // BorderStyle 1, outline 2, alignment 8
    const full = createAss(project("full-bleed"));
    expect(full).not.toContain(`,${CARD.subtitleTop},1`);
  });

  it("normalises loudness only when asked and keeps the limiter last", () => {
    expect(buildAudioMixFilter(false, 0.12, 5000)).not.toContain("loudnorm");
    const withNorm = buildAudioMixFilter(true, 0.12, 5000, 1, true);
    expect(withNorm).toContain("loudnorm=I=-14");
    expect(withNorm.endsWith("alimiter=limit=0.95:level=false:latency=true[a]")).toBe(true);
  });

  it("synthesises the ambient pad from 16 sine tones in four cross-faded chords", () => {
    const args = buildAmbientMusicArgs("/tmp/pad.wav");
    expect(args.filter((arg) => arg.startsWith("sine=f="))).toHaveLength(16);
    expect(args.join(" ")).toContain("adelay=24000:all=1");
    expect(args.at(-1)).toBe("/tmp/pad.wav");
  });
});

describe("recurring cast for story cards", () => {
  it("builds a mother-and-child pair with fixed outfits in story order", () => {
    const cast = castForScript("Mẹ nhường cơm cho con, nhưng chưa bao giờ kể rằng mình đã đói.");
    expect(cast).toContain("mother with a black bun, red blouse and brown skirt");
    expect(cast).toMatch(/and her little girl with two pigtails/);
  });

  it("recognises a son, a grandmother and a father", () => {
    expect(castForScript("Bà ngoại kể chuyện cho cháu trai nghe mỗi tối.")).toMatch(/grandmother.*his little boy/);
    expect(castForScript("Bố đưa con trai đi học mỗi sáng.")).toMatch(/father.*little boy/);
  });

  it("does not mistake 'con đường' or 'con người' for a child", () => {
    expect(castForScript("Mẹ chọn con đường khó, vì con người cần nghị lực.")).not.toMatch(/little/);
  });

  it("falls back to a lone protagonist, and to nothing when no role is named", () => {
    expect(castForScript("Cô gái ngồi viết nhật ký mỗi tối.")).toContain("young woman");
    expect(castForScript("Cuộc đời ngắn lắm, hãy sống thật bình yên.")).toBe("");
  });
});
