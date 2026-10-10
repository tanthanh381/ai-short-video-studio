import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("fixes the channel layout around the loudness chain so mono narration without music can render", () => {
    const filter = buildAudioMixFilter(false, 0.12, 5000, 1, true);
    // ffmpeg 5.1 fails "Cannot select channel layout" if aresample feeds alimiter directly, or the input stays a guessed mono.
    expect(filter.startsWith("[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=")).toBe(true);
    expect(filter).toMatch(/aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,alimiter=/);
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

  it("casts the two brothers of a sibling story, not the parents who died", () => {
    const cast = castForScript("Ngày xửa ngày xưa, có hai anh em sống nương tựa vào nhau từ khi cha mẹ mất sớm. Người anh tham lam, người em hiền lành.");
    expect(cast).toBe("two young Vietnamese brothers in ancient peasant clothes, the big brother in a red tunic, the little brother in a blue tunic");
    expect(cast).not.toMatch(/\b(?:elder|older)\b/u);
    expect(castForScript("Hai anh em đi học, người anh chở người em bằng xe đạp.")).toContain("red t-shirt");
    expect(cast).not.toMatch(/mother|father/u);
    expect(castForScript("Cậu bé mồ côi cha mẹ, sống với bà ngoại.")).toMatch(/grandmother/u);
  });

  it("falls back to a lone protagonist, and to nothing when no role is named", () => {
    expect(castForScript("Cô gái ngồi viết nhật ký mỗi tối.")).toContain("young woman");
    expect(castForScript("Cuộc đời ngắn lắm, hãy sống thật bình yên.")).toBe("");
  });
});

describe("paper stage (Đạo lý cổ phong)", () => {
  it("is a 9:16 frame with a square picture and the same mascot", async () => {
    const { usesPaperStage, PAPER, PAPER_MASCOT, paperStageFilter, paperFeatherFilter } = await import("./card-layout");
    const { imageAspectFor } = await import("./providers");
    expect(usesPaperStage({ layoutTemplate: "paper-stage", aspectRatio: "9:16" })).toBe(true);
    expect(usesPaperStage({ layoutTemplate: "paper-stage", aspectRatio: "16:9" })).toBe(false);
    expect(imageAspectFor({ layoutTemplate: "paper-stage", aspectRatio: "9:16" })).toBe("1:1");
    expect(PAPER_MASCOT).toMatch(/chibi/);
    // the character stands on the same line in every scene and the captions start below it
    expect(PAPER.stageBottom).toBeLessThan(PAPER.captionTop);
    expect(paperStageFilter(0)).toContain(`y='${PAPER.stageBottom}-h'`);
    // breathing and swaying differ in phase from scene to scene
    expect(paperStageFilter(1)).not.toBe(paperStageFilter(0));
    expect(paperFeatherFilter()).toContain(`scale=${PAPER.stage}:${PAPER.stage}`);
    // the sheet is flat: a vignette (smaller angle = stronger) once darkened its corners by 11%
    const { paperGrainArgs, PAPER_HEX } = await import("./card-layout");
    expect(paperGrainArgs("/tmp/p.png").join(" ")).not.toMatch(/vignette/);
    expect(PAPER_HEX).toBe("d3bb87"); // RGB 211,187,135 measured from the reference short
    // every picture is shifted onto the same kraft: measured from its lightest corner (hair or a prop is darker)
    const { paperShift } = await import("./card-layout");
    expect(paperShift([[60, 70, 40], [201, 197, 140], [190, 185, 130], [90, 80, 60]])).toEqual([10, -10, -5]);
    expect(paperShift([[255, 255, 255]])).toEqual([-44, -60, -60]); // capped: never more than ±60 a channel
    expect(paperFeatherFilter([10, -10, -5])).toContain("r='clip(r(X,Y)+10,0,255)'");
  });

  it("keeps every picture to the same mascot on bare paper: no places, no camera words", async () => {
    const { paperStagePrompt, PAPER_MASCOT } = await import("./card-layout");
    // prompts the storyboard wrote for the first Đạo lý cổ phong test video
    const written = [
      "Chibi figure in olive green robe standing alone on dusty village road holding bamboo shoulder pole with two baskets, full body shot low angle wide depth",
      "a little chibi boy with a topknot hair bun and a long olive headband ribbon, wearing an olive green ancient robe. Close up chibi face in olive green robe, eyes closed, quiet sad smile",
      "Full body chibi in olive green robe walking alone through misty forest path carrying heavy bamboo shoulder pole with two baskets, low angle wide shot",
      "Close-up of a chibi figure in olive green robe smiling softly, holding out a small warm cup against grey rain-swept street background, shallow depth of field",
    ];
    const prompts = written.map(paperStagePrompt);
    for (const prompt of prompts) {
      expect(prompt.startsWith(`${PAPER_MASCOT}, `)).toBe(true);
      expect(prompt.split(PAPER_MASCOT).length - 1).toBe(1);
      expect(prompt).not.toMatch(/village|road|forest|street|background|shot|angle|depth of field|close-?up/iu);
    }
    expect(prompts[0]).toContain("holding bamboo shoulder pole with two baskets");
    expect(prompts[1]).toContain("eyes closed, quiet sad smile");
    expect(prompts[3]).toContain("holding out a small warm cup");
    expect(paperStagePrompt("Chibi figure sitting cross-legged holding open book while another chibi listens nearby")).toContain("while another small child listens");
  });

  it("grains the whole frame with one fixed paper, character included, without changing the sheet's colour", async () => {
    const { paperGrainArgs, paperStageFilter, PAPER_GRAIN, PAPER_HEX } = await import("./card-layout");
    // one seed: a new pattern at every scene cut would show as a pop
    expect(paperGrainArgs("/tmp/g.png").join(" ")).toContain(`all_seed=${PAPER_GRAIN.seed}`);
    expect(paperGrainArgs("/tmp/g.png").join(" ")).toContain("format=gray");
    const filter = paperStageFilter(0);
    expect(filter).toContain(`color=c=0x${PAPER_HEX}`); // the sheet itself is flat; the grain comes from input 2
    expect(filter).toContain(`blend=c0_expr='A+(B-${PAPER_GRAIN.neutral})*${PAPER_GRAIN.strength}'`);
    expect(filter).toContain("c1_mode=normal"); // luma only: the colour planes stay as they are
    expect(filter.indexOf("overlay=")).toBeLessThan(filter.indexOf("blend=")); // grain over the character, not under it
  });

  const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!ffmpegAvailable)("renders a frame with the reference's grain (std 5.5), the same on paper and inside the picture", async () => {
    const { paperGrainArgs, paperStageFilter, PAPER } = await import("./card-layout");
    const dir = mkdtempSync(join(tmpdir(), "paper-grain-"));
    try {
      const run = (args: string[]) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });
      run(paperGrainArgs(join(dir, "grain.png")));
      // a character picture whose own paper is flat kraft: the case that would show as a smooth patch
      run(["-y", "-f", "lavfi", "-i", `color=c=0xD3BB87:s=${PAPER.stage}x${PAPER.stage}:d=1`, "-frames:v", "1", join(dir, "picture.png")]);
      const raw = run(["-loop", "1", "-framerate", "30", "-i", join(dir, "picture.png"), "-i", join(dir, "grain.png"), "-t", "0.2",
        "-filter_complex", paperStageFilter(0).replace("[2:v]", "[1:v]"), "-map", "[v]", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      expect(raw.length).toBe(PAPER.width * PAPER.height * 3);
      const patch = (x0: number, y0: number, w: number, h: number) => {
        const sums = [0, 0, 0], squares = [0, 0, 0];
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) for (let c = 0; c < 3; c++) {
          const v = raw[(y * PAPER.width + x) * 3 + c]!;
          sums[c] += v; squares[c] += v * v;
        }
        const n = w * h;
        return sums.map((sum, c) => ({ mean: sum / n, std: Math.sqrt(squares[c]! / n - (sum / n) ** 2) }));
      };
      const corner = patch(0, 0, 90, 150);
      const inside = patch(PAPER.width / 2 - 150, PAPER.stageBottom - 450, 300, 300);
      corner.forEach((channel, c) => {
        expect(Math.abs(channel.mean - PAPER.paper[c]!)).toBeLessThan(8); // same kraft as the reference sheet
        expect(channel.std).toBeGreaterThan(3); // a flat sheet had 2.6
        expect(channel.std).toBeLessThan(9);
        expect(Math.abs(channel.std - inside[c]!.std)).toBeLessThan(1.5); // no smooth patch where the picture is
      });
      expect(Math.abs(corner[0]!.std - corner[2]!.std)).toBeLessThan(0.5); // grey grain: no colour noise
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the boy's own action and prop: no object as the subject, no leftovers of a dropped place", async () => {
    const { paperStagePrompt, PAPER_MASCOT } = await import("./card-layout");
    const action = (prompt: string) => paperStagePrompt(prompt).slice(PAPER_MASCOT.length + 2);
    // the writer's own subject is dropped (the mascot is put in front), the action stays
    expect(action("Small chibi figure sitting cross-legged holding an open book")).toBe("sitting cross-legged holding an open book");
    expect(action("Tiny chibi character holding single water drop")).toBe("holding single water drop");
    expect(action("Small chibi rock sitting alone")).toBe("rock sitting alone"); // never "he rock"
    // props whose name contains a scenery word survive: a paper lantern is not "on paper", a raindrop is not "rain"
    expect(action("sitting beside a glowing paper lantern while holding a cup of tea")).toBe("sitting beside a glowing paper lantern while holding a cup of tea");
    expect(action("sitting beside a single raindrop glass")).toBe("sitting beside a single raindrop glass");
    // while real places, weather and camera words still go
    expect(action("standing on kraft paper background holding a fan, soft warm light, low angle view")).toBe("standing holding a fan");
    expect(action("walking through rain-swept street holding an umbrella")).toBe("walking holding an umbrella");
    // what a dropped place leaves behind is trimmed, and an empty answer falls back to a calm pose
    expect(action("sitting beside a wall")).toBe("sitting");
    expect(action("in a misty forest, wide shot")).toBe("standing calmly");
  });

  it("puts the captions under the character, small and without a box", async () => {
    const { createAss } = await import("./render");
    const { PAPER } = await import("./card-layout");
    const scene = { id: "s", order: 0, narration: "Đừng quá khó ăn khó ở.", imagePrompt: "p", estimatedDurationMs: 2000, actualDurationMs: 2000,
      imagePath: "a", videoPath: null, audioPath: "b", thumbnailUrl: null, mediaStatus: "ready", errorMessage: null, annotationJson: null,
      subtitles: [{ id: "c", text: "Đừng quá khó ăn khó ở.", startMs: 0, endMs: 2000 }] };
    const ass = createAss({ settings: { ...DEFAULT_PROJECT_SETTINGS, layoutTemplate: "paper-stage", aspectRatio: "9:16",
      subtitle: { ...DEFAULT_PROJECT_SETTINGS.subtitle, fontColor: "#3E3A22", backgroundOpacity: 0 } }, scenes: [scene] } as never);
    const style = ass.split("\n").find((line) => line.startsWith("Style: Default"))!.split(",");
    expect(style[18]).toBe("8"); // top-anchored ...
    expect(style[21]).toBe(String(PAPER.captionTop)); // ... just under the character
    expect(style[15]).toBe("1"); // outline only, no box
  });
});
