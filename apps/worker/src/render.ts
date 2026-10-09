import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { drawsByHand, type Project, type Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { buildAudioMixFilter, buildAmbientMusicArgs, validateCaptionTiming } from "./render-quality";
import { CARD, PAPER, brandInitials, cardFooterLines, cardTitleFontSize, fallbackCardTitle, PAPER_CORNERS, paperCanvasArgs, paperFeatherFilter, paperShift, paperStageFilter, splitCardTitle, usesPaperStage, usesStoryCard } from "./card-layout";
import { drawSceneByHand } from "./whiteboard";

const exec = promisify(execFile);
export type RenderFiles = {
  output: string;
  thumbnail: string;
  workdir: string;
  durationMs: number;
};

export function videoSize(ratio: string) {
  return ratio === "16:9"
    ? { width: 1920, height: 1080 }
    : ratio === "1:1"
      ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };
}

/** Faster presets reduce encode latency without changing resolution or CRF. */
export function videoEncoderPreset(preset?: string) {
  return preset === "fast" ? "veryfast" : preset === "quality" ? "medium" : "faster";
}
export function assTime(ms: number) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
function assEscape(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\N");
}
/**
 * One caption with karaoke timing: each word gets a share of the cue proportional to its length, and ASS turns
 * it from the secondary colour to the primary (highlight) colour when its turn comes. Cue boundaries come from
 * the measured alignment, so the approximation only spans the two or three seconds of one cue.
 */
export function karaokeText(text: string, durationMs: number): string {
  const parts = text.split(/(\s+)/u);
  const words = parts.filter((part, index) => index % 2 === 0 && part.length > 0);
  const weights = words.map((word) => Math.max(1, (word.match(/[\p{L}\p{N}]/gu) ?? []).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const centiseconds = Math.max(words.length, Math.round(durationMs / 10));
  let used = 0;
  let wordIndex = 0;
  return parts.map((part, index) => {
    if (index % 2 === 1) return assEscape(part.includes("\n") ? "\n" : " ");
    if (!part) return "";
    const last = wordIndex === words.length - 1;
    const share = last ? centiseconds - used : Math.max(1, Math.round((weights[wordIndex]! / total) * centiseconds));
    used += share;
    wordIndex++;
    return `{\\k${share}}${assEscape(part)}`;
  }).join("");
}

/** Bright captions get a yellow highlight, dark ones (ink look) a deep red one. */
function highlightColor(fontColor: string): string {
  const value = fontColor.replace("#", "");
  const luminance = (0.299 * parseInt(value.slice(0, 2), 16) + 0.587 * parseInt(value.slice(2, 4), 16) + 0.114 * parseInt(value.slice(4, 6), 16)) / 255;
  return luminance > 0.5 ? "#FFE14D" : "#B42318";
}

function assColor(hex: string, alpha = 0) {
  const value = hex.replace("#", "");
  const red = value.slice(0, 2);
  const green = value.slice(2, 4);
  const blue = value.slice(4, 6);
  return `&H${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}${blue}${green}${red}`.toUpperCase();
}
export function createAss(project: Project) {
  const { width, height } = videoSize(project.settings.aspectRatio);
  const style = project.settings.subtitle;
  const cardMode = usesStoryCard(project.settings);
  const paperMode = usesPaperStage(project.settings);
  // Story card: captions sit directly under the picture band, top-anchored, in a calmer size. Paper stage: under
  // the character, small and quiet.
  const alignment = cardMode || paperMode ? 8 : style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const marginV = cardMode
    ? CARD.subtitleTop
    : paperMode
      ? PAPER.captionTop
      : style.position === "bottom"
      ? Math.round(height * 0.16)
      : Math.round(height * 0.1);
  const fontSize = paperMode
    ? Math.round(height * 0.026)
    : cardMode
    ? Math.round(height * 0.03)
    : style.preset === "focus"
      ? Math.round(height * 0.042)
      : style.preset === "minimal"
        ? Math.round(height * 0.029)
        : Math.round(height * 0.034);
  const card = usesStoryCard(project.settings);
  const outline = style.preset === "minimal" ? 1 : 2;
  const borderStyle = card ? 1 : style.backgroundOpacity > 0 ? 3 : 1;
  const highlight = project.settings.captionHighlight === true;
  // Karaoke: words start in the caption colour (secondary) and switch to the highlight (primary) when spoken.
  const primary = highlight ? assColor(highlightColor(style.fontColor)) : assColor(style.fontColor);
  let offset = 0;
  const lines: string[] = [];
  for (const scene of project.scenes) {
    for (const cue of scene.subtitles) {
      const text = highlight ? karaokeText(cue.text, cue.endMs - cue.startMs) : assEscape(cue.text);
      lines.push(
        `Dialogue: 0,${assTime(offset + cue.startMs)},${assTime(offset + cue.endMs)},Default,,0,0,0,,${text}`,
      );
    }
    offset += scene.actualDurationMs ?? scene.estimatedDurationMs;
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,${fontSize},${primary},${assColor(style.fontColor)},${assColor(style.outlineColor)},${assColor(style.backgroundColor, 1 - style.backgroundOpacity)},-1,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment},${Math.round(width * 0.07)},${Math.round(width * 0.07)},${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
}

/** Camera moves cycled across scenes so consecutive stills never move the same way. */
const CAMERA_MOVES = ["push", "pull", "panRight", "panLeft", "rise"] as const;

/**
 * Camera motion on a still: push-in, pull-out, pan left/right or rise, chosen by scene order. A scene held longer
 * than 6.5 s also gets a punch-in cut halfway (closer framing on the upper middle, where faces usually are), so the
 * picture changes every 3-6 s without generating another image. Expressions use the output frame number `on`.
 */
export function sceneMotion(seconds: number, index = 0): string {
  const frames = Math.max(1, Math.round(seconds * 30));
  const progress = `(on/${frames})`;
  const centreX = "iw/2-iw/zoom/2";
  const centreY = "ih/2-ih/zoom/2";
  const move = CAMERA_MOVES[index % CAMERA_MOVES.length];
  const [z, x, y] = move === "pull" ? [`1.08-0.07*${progress}`, centreX, centreY]
    : move === "panRight" ? ["1.1", `(iw-iw/zoom)*${progress}`, centreY]
    : move === "panLeft" ? ["1.1", `(iw-iw/zoom)*(1-${progress})`, centreY]
    : move === "rise" ? ["1.1", centreX, `(ih-ih/zoom)*(1-${progress})`]
    : [`1+0.06*${progress}`, centreX, centreY];
  if (seconds <= 6.5) return `zoompan=z='${z}':x='${x}':y='${y}':d=1`;
  const cut = Math.round(frames / 2);
  return `zoompan=z='if(lt(on,${cut}),${z},min(1.22+0.0003*(on-${cut}),1.3))'`
    + `:x='if(lt(on,${cut}),${x},${centreX})':y='if(lt(on,${cut}),${y},(ih-ih/zoom)*0.3)':d=1`;
}

/** How many scene segments ffmpeg renders at once (bounded by the Docker VM's CPUs). */
const SEGMENT_CONCURRENCY = Math.max(1, Math.min(Number(process.env.RENDER_CONCURRENCY ?? "3") || 3, 6));

/** Like Promise.all over `items`, but at most `limit` running at a time; results keep the input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Big title over the first seconds of a full-frame video: viewers decide within ~3 s whether to keep watching. Two
 * balanced upper-case lines in yellow with a dark outline, faded out between 2.4 s and 3 s. Text comes from files.
 */
export function hookOverlayFilters(lineFiles: string[], lines: string[], width: number, height: number): string[] {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const size = Math.max(40, Math.min(Math.round(Math.min(width, height) * 0.085), Math.floor((width * 0.88) / (longest * 0.62))));
  // High enough to clear most faces (portraits put eyes at 15-30%), with a translucent box so it reads on any picture.
  const top = Math.round(height * 0.09);
  return lineFiles.map((file, index) =>
    `drawtext=fontfile=${FONT_BOLD}:textfile=${file}:fontsize=${size}:fontcolor=0xFFE14D:borderw=5:bordercolor=0x101010`
    + `:box=1:boxcolor=0x000000@0.38:boxborderw=14`
    + `:x=(w-text_w)/2:y=${top + index * Math.round(size * 1.3)}`
    + `:enable='lt(t,3)':alpha='if(lt(t,2.4),1,max(0,(3-t)/0.6))'`);
}

export async function durationMs(config: WorkerConfig, path: string) {
  const { stdout } = await exec(
    config.FFPROBE_PATH,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { timeout: 30_000 },
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("File audio/video không có thời lượng hợp lệ");
  return Math.round(duration * 1000);
}
const FONT_BOLD = process.env.CARD_FONT_BOLD ?? "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf";
const FONT_ITALIC = process.env.CARD_FONT_ITALIC ?? "/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf";

/** Static story-card background: gradient + vignette + title banner + channel footer, rendered once per video. */
export async function buildCardFrame(config: WorkerConfig, workdir: string, project: Project): Promise<string> {
  const title = project.settings.cardTitle.trim() || project.suggestedTitle.trim() || fallbackCardTitle(project.sourceText);
  const lines = splitCardTitle(title);
  const titleSize = cardTitleFontSize(lines);
  const textFile = async (name: string, text: string) => { const path = join(workdir, name); await writeFile(path, text, "utf8"); return path; };
  const draw: string[] = [];
  for (const [index, line] of lines.entries()) {
    const file = await textFile(`card-title-${index}.txt`, line);
    draw.push(`drawtext=fontfile=${FONT_BOLD}:textfile=${file}:fontsize=${titleSize}:fontcolor=${CARD.titleColor}:borderw=3:bordercolor=0x14202a:shadowcolor=0x000000@0.45:shadowx=3:shadowy=4:x=(w-text_w)/2:y=${CARD.titleTop + index * CARD.titleLineGap}`);
  }
  for (const [index, line] of cardFooterLines(project.settings.brandName).entries()) {
    const file = await textFile(`card-footer-${index}.txt`, line);
    draw.push(`drawtext=fontfile=${FONT_ITALIC}:textfile=${file}:fontsize=${CARD.footerSize}:fontcolor=${CARD.footerColor}:borderw=1:bordercolor=0x14202a:x=(w-text_w)/2:y=${CARD.footerTop + index * 44}`);
  }
  const background = `[0:v]vignette=angle=PI/6,format=rgb24${draw.length ? "," + draw.join(",") : ""}[bg]`;
  const frame = join(workdir, "card-frame.png");
  const gradient = `gradients=s=${CARD.width}x${CARD.height}:c0=${CARD.gradientTop}:c1=${CARD.gradientBottom}:x0=540:y0=0:x1=540:y1=${CARD.height}:nb_colors=2:speed=0.00001:duration=1:rate=1`;
  const initials = brandInitials(project.settings.brandName);
  // With a brand but no uploaded logo, draw a round badge with the channel's initials in the logo spot.
  const wantsBadge = Boolean(initials) && !project.settings.logoPath;
  if (!wantsBadge) {
    await exec(config.FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", gradient, "-filter_complex", `${background};[bg]null[out]`, "-map", "[out]", "-frames:v", "1", "-update", "1", frame],
      { timeout: 60_000 });
    return frame;
  }
  const size = CARD.badgeSize;
  const centre = size / 2;
  const initialsFile = await textFile("card-badge.txt", initials);
  const inside = `lte(hypot(X-${centre},Y-${centre}),${centre - 9})`;
  const badge = `[1:v]format=rgba,geq=r='if(${inside},27,255)':g='if(${inside},53,210)':b='if(${inside},80,31)':a='if(lte(hypot(X-${centre},Y-${centre}),${centre - 2}),255,0)',`
    + `drawtext=fontfile=${FONT_BOLD}:textfile=${initialsFile}:fontsize=${Math.round(size * 0.4)}:fontcolor=${CARD.titleColor}:x=(w-text_w)/2:y=(h-text_h)/2-4[badge]`;
  await exec(config.FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", gradient, "-f", "lavfi", "-i", `color=c=black:s=${size}x${size}:d=1:r=1`,
    "-filter_complex", `${background};${badge};[bg][badge]overlay=(W-w)/2:${CARD.badgeY}:format=auto[out]`, "-map", "[out]", "-frames:v", "1", "-update", "1", frame],
    { timeout: 60_000 });
  return frame;
}

export async function renderProject(
  config: WorkerConfig,
  project: Project,
  getFile: (path: string) => Promise<Uint8Array>,
  onProgress: (value: number, stage: string) => Promise<void>,
): Promise<RenderFiles> {
  if (!project.scenes.length) throw new Error("Dự án chưa có cảnh");
  const orders = project.scenes.map((scene) => scene.order);
  if (orders.some((order) => !Number.isInteger(order) || order < 0) || new Set(orders).size !== orders.length)
    throw new Error("Scene orders must be unique non-negative integers");
  const workdir = await mkdtemp(join(tmpdir(), "short-video-"));
  try {
    const { width, height } = videoSize(project.settings.aspectRatio);
    const encoderPreset = videoEncoderPreset(project.settings.generationPreset);
    const cardFrame = usesStoryCard(project.settings) ? await buildCardFrame(config, workdir, project) : null;
    const paperStage = usesPaperStage(project.settings);
    let done = 0;
    const renderSegment = async (scene: Scene) => {
      if ((!scene.imagePath && !scene.videoPath) || !scene.audioPath)
        throw new Error(`Cảnh ${scene.order + 1} chưa có đủ media và giọng đọc`);
      const imagePath = join(workdir, `scene-${scene.order}.png`);
      const motionPath = join(workdir, `scene-${scene.order}.mp4`);
      const audioPath = join(workdir, `scene-${scene.order}.mp3`);
      const segmentPath = join(workdir, `scene-${scene.order}.mkv`);
      if (scene.videoPath) await writeFile(motionPath, await getFile(scene.videoPath));
      else await writeFile(imagePath, await getFile(scene.imagePath!));
      await writeFile(audioPath, await getFile(scene.audioPath));
      const ms = await durationMs(config, audioPath);
      if (project.settings.subtitle.enabled) validateCaptionTiming(scene, ms);
      scene.actualDurationMs = ms;
      const seconds = ms / 1000;
      // Straight cuts preserve measured timing and avoid a black opening/boundaries.
      const monochrome = project.settings.visualPreset === "ink-monochrome" ? ",hue=s=0,eq=contrast=1.04:brightness=0.01" : "";
      // Whiteboard: the hand renderer draws the still at the segment's size; that clip replaces the camera move and is
      // then treated like an uploaded scene video (held on its last frame if it ends before the voice).
      const handDrawn = drawsByHand(project.settings) && !scene.videoPath;
      if (handDrawn) {
        const size = cardFrame ? { width: CARD.width, height: CARD.bandH } : { width, height };
        const stillPath = join(workdir, `scene-${scene.order}-still.png`);
        await exec(config.FFMPEG_PATH, ["-y", "-i", imagePath, "-vf",
          `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${size.width}:${size.height},unsharp=5:5:0.6:5:5:0.0`,
          "-frames:v", "1", stillPath], { timeout: 60_000 });
        await drawSceneByHand(config, scene, stillPath, size, ms, motionPath);
      }
      // Paper stage: the character on a paper of its own backdrop colour (input 2), breathing; see card-layout.ts.
      let paperCanvas: string | null = null;
      if (paperStage && !scene.videoPath && !handDrawn) {
        const feathered = join(workdir, `scene-${scene.order}-character.png`);
        const corners: Array<[number, number, number]> = [];
        for (const corner of PAPER_CORNERS) {
          const { stdout } = await exec(config.FFMPEG_PATH, ["-v", "error", "-i", imagePath, "-vf", corner, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            { encoding: "buffer", timeout: 30_000 }) as unknown as { stdout: Buffer };
          if (stdout.length >= 3) corners.push([stdout[0]!, stdout[1]!, stdout[2]!]);
        }
        await exec(config.FFMPEG_PATH, ["-y", "-i", imagePath, "-vf", paperFeatherFilter(paperShift(corners)), "-frames:v", "1", feathered], { timeout: 60_000 });
        paperCanvas = join(workdir, "paper.png");
        await exec(config.FFMPEG_PATH, paperCanvasArgs(paperCanvas), { timeout: 60_000 });
        await writeFile(imagePath, await readFile(feathered));
      }
      const clip = Boolean(scene.videoPath) || handDrawn;
      // An uploaded clip loops to cover the voice; a drawing must not start over, so it holds its finished frame.
      const clipFrames = handDrawn ? "fps=30,tpad=stop_mode=clone:stop_duration=2" : "fps=30";
      const motionFilter = sceneMotion(seconds, scene.order);
      // Stills are scaled to twice the output before the camera move: zoompan rounds positions to whole pixels,
      // which made slow pans stutter (frame-to-frame motion stdev 1.39 -> 0.87); then a light sharpen for the upscale.
      const sharpen = ",unsharp=5:5:0.5:5:5:0.0";
      const filter = paperCanvas
        ? paperStageFilter(scene.order)
        : cardFrame
        // Story card: the picture lives in a 16:10 band over the pre-rendered background (input 2).
        ? clip
          ? `[0:v]scale=${CARD.width}:${CARD.bandH}:force_original_aspect_ratio=increase,crop=${CARD.width}:${CARD.bandH},${clipFrames},format=yuv420p[band];[2:v]format=yuv420p[bg];[bg][band]overlay=0:${CARD.bandY},format=yuv420p[v]`
          : `[0:v]scale=${CARD.width * 2}:${CARD.bandH * 2}:force_original_aspect_ratio=increase,crop=${CARD.width * 2}:${CARD.bandH * 2}${monochrome},${motionFilter}:s=${CARD.width}x${CARD.bandH}:fps=30${sharpen}[band];[2:v]format=yuv420p[bg];[bg][band]overlay=0:${CARD.bandY},format=yuv420p[v]`
        : clip
          ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${clipFrames},format=yuv420p[v]`
          : `[0:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2}${monochrome},${motionFilter}:s=${width}x${height}:fps=30${sharpen},format=yuv420p[v]`;
      const videoInput = scene.videoPath ? ["-stream_loop", "-1", "-i", motionPath] : handDrawn ? ["-i", motionPath] : ["-loop", "1", "-framerate", "30", "-i", imagePath];
      await exec(
        config.FFMPEG_PATH,
        [
          "-y",
          ...videoInput,
          "-i",
          audioPath,
          ...(paperCanvas ? ["-loop", "1", "-framerate", "30", "-i", paperCanvas] : cardFrame ? ["-loop", "1", "-framerate", "30", "-i", cardFrame] : []),
          "-t",
          seconds.toFixed(3),
          "-filter_complex",
          filter,
          "-map",
          "[v]",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          // Intermediate only: the final pass re-encodes every frame, so encode fast and near-lossless here
          // instead of compressing twice (CRF 22 then CRF 21 lost detail and took twice the CPU).
          "-preset",
          "ultrafast",
          "-crf",
          "16",
          "-c:a",
          "pcm_s16le",
          "-ar",
          "48000",
          "-shortest",
          segmentPath,
        ],
        {
          maxBuffer: 10_000_000,
          timeout: config.RENDER_TIMEOUT_MS ?? 900_000,
        },
      );
      // Concat starts the next scene at the encoded segment boundary (30 fps).
      // Use that measured boundary for caption offsets, retaining true audio
      // duration on the stored scene. No estimated target duration is used.
      const timelineScene = { ...scene, actualDurationMs: await durationMs(config, segmentPath) };
      done++;
      await onProgress(
        15 + Math.round((done / project.scenes.length) * 55),
        `Đã dựng cảnh ${done}/${project.scenes.length}`,
      );
      return { segmentPath, timelineScene };
    };
    // Scenes are independent until the concat: render a few at once (zoompan and x264 each leave cores idle).
    const rendered = await mapWithConcurrency(project.scenes, SEGMENT_CONCURRENCY, renderSegment);
    const segments = rendered.map((item) => item.segmentPath);
    const timelineScenes: Scene[] = rendered.map((item) => item.timelineScene);
    const concatList = join(workdir, "concat.txt");
    await writeFile(
      concatList,
      segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const base = join(workdir, "base.mkv");
    await exec(
      config.FFMPEG_PATH,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c",
        "copy",
        base,
      ],
      { timeout: config.RENDER_TIMEOUT_MS ?? 900_000 },
    );
    const total = await durationMs(config, base);
    const ass = join(workdir, "subtitles.ass");
    await writeFile(ass, createAss({ ...project, scenes: timelineScenes }), "utf8");
    const output = join(workdir, "output.mp4");
    const args = ["-y", "-i", base];
    let logoPath: string | null = null;
    if (project.settings.logoPath) {
      logoPath = join(workdir, "logo");
      await writeFile(logoPath, await getFile(project.settings.logoPath));
      args.push("-loop", "1", "-i", logoPath);
    }
    let musicPath: string | null = null;
    let musicVolume = project.settings.musicVolume;
    if (!project.settings.backgroundMusicPath && project.settings.autoMusic) {
      musicPath = join(workdir, "ambient.wav");
      await exec(config.FFMPEG_PATH, buildAmbientMusicArgs(musicPath), { timeout: 60_000 });
      args.push("-stream_loop", "-1", "-i", musicPath);
      musicVolume = Math.max(musicVolume, 0.35); // the synthesised pad is quiet by design
    } else if (project.settings.backgroundMusicPath) {
      musicPath = join(workdir, "music");
      await writeFile(
        musicPath,
        await getFile(project.settings.backgroundMusicPath),
      );
      args.push("-stream_loop", "-1", "-i", musicPath);
    }
    const escapedAss = ass
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    // Use the explicit `filename` option: FFmpeg 8/9 parses a quoted filename
    // followed by `fontsdir` differently from older builds.
    // Older projects kept a copy of the script's start in `hook`: fall back to a short title from the script.
    const hookText = project.hook.trim().split(/\s+/u).length <= 10 && project.hook.trim() ? project.hook : fallbackCardTitle(project.sourceText);
    const hookLines = !usesStoryCard(project.settings) && project.settings.hookTitle ? splitCardTitle(hookText, 16) : [];
    const hookFiles: string[] = [];
    for (const [index, line] of hookLines.entries()) {
      const file = join(workdir, `hook-${index}.txt`);
      await writeFile(file, line, "utf8");
      hookFiles.push(file);
    }
    const hook = hookFiles.length ? `${hookOverlayFilters(hookFiles, hookLines, width, height).join(",")},` : "";
    let filter = `[0:v]${project.settings.subtitle.enabled ? `subtitles=filename='${escapedAss}':fontsdir=/usr/share/fonts/truetype/noto,` : ""}${hook}format=yuv420p[base]`;
    if (logoPath) {
      const margin = Math.round(width * 0.04);
      const x = project.settings.logoPosition === "top-center" ? "(W-w)/2" : project.settings.logoPosition.endsWith("right") ? `W-w-${margin}` : `${margin}`;
      const y = project.settings.logoPosition.startsWith("bottom") ? `H-h-${margin}` : `${margin}`;
      const logoWidth = Math.round(width * project.settings.logoScale);
      filter += `;[1:v]scale=${logoWidth}:-1:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${project.settings.logoOpacity}[logo];[base][logo]overlay=x=${x}:y=${y}:format=auto[v]`;
    } else {
      filter += ";[base]null[v]";
    }
    filter += `;${buildAudioMixFilter(Boolean(musicPath), musicVolume, total, logoPath ? 2 : 1, true)}`;
    args.push(
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      encoderPreset,
      "-crf",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      "-t",
      (total / 1000).toFixed(3),
      output,
    );
    await onProgress(78, "Đang ghép phụ đề và âm thanh");
    await exec(config.FFMPEG_PATH, args, {
      maxBuffer: 20_000_000,
      timeout: config.RENDER_TIMEOUT_MS ?? 900_000,
    });
    const thumbnail = join(workdir, "thumbnail.jpg");
    // A hand-drawn video opens on blank paper: take the first scene once its drawing is finished.
    const firstSceneMs = timelineScenes[0]?.actualDurationMs ?? 0;
    const thumbnailAt = drawsByHand(project.settings) && firstSceneMs > 1500 ? (firstSceneMs - 300) / 1000 : Math.min(0.5, total / 2000);
    await exec(
      config.FFMPEG_PATH,
      [
        "-y",
        "-ss",
        thumbnailAt.toFixed(3),
        "-i",
        output,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnail,
      ],
      { timeout: 60_000 },
    );
    await onProgress(94, "Đang tải bản xuất lên kho riêng tư");
    return {
      output,
      thumbnail,
      workdir,
      durationMs: await durationMs(config, output),
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
