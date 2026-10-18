import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { drawsByHand, logoAnchor, logoOverlayXY, type Project, type Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { EXPORT_LIMIT_BYTES, buildAudioMixFilter, buildAmbientMusicArgs, exportRateArgs, exportTooLargeMessage, validateCaptionTiming } from "./render-quality";
import { BLURRED_CARD, CARD, PAPER, SEPIA, progressBarY, brandInitials, cardThemeOf, sepiaLineSize, sepiaTitleLines, cardFooterLines, cardTitleFontSize, fallbackCardTitle, PAPER_CORNERS, paperGrainArgs, paperFeatherFilter, paperShift, paperStageFilter, splitCardTitle, usesBlurredStoryCard, usesPaperStage, usesStoryCard } from "./card-layout";
import { drawSceneByHand, type WhiteboardRunner } from "./whiteboard";

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

type OutputProbe = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
};

/**
 * The renderer is the last boundary before a file becomes user-visible. Keep this
 * check deliberately small and deterministic: semantic quality is reviewed by the
 * storyboard/media gates, while this prevents a corrupt or incomplete MP4 from
 * being uploaded as a successful export.
 */
export function validateRenderedOutput(probe: OutputProbe, expected: { width: number; height: number }) {
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  if (!video || video.codec_name !== "h264" || video.width !== expected.width || video.height !== expected.height)
    throw new Error("Bản xuất không đạt định dạng video H.264 hoặc sai kích thước khung hình");
  if (!audio || audio.codec_name !== "aac")
    throw new Error("Bản xuất không có audio AAC hợp lệ");
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Bản xuất có thời lượng không hợp lệ");
  return duration;
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
  const sepia = cardMode && cardThemeOf(project.settings) === "sepia";
  // Story card: captions sit directly under the picture band, top-anchored, in a calmer size. Paper stage: under
  // the character, small and quiet.
  const alignment = cardMode || paperMode ? 8 : style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const marginV = sepia
    ? SEPIA.captionTop
    : cardMode
    ? CARD.subtitleTop
    : paperMode
      ? PAPER.captionTop
      : style.position === "bottom"
      ? Math.round(height * (height > width ? 0.24 : 0.16)) // portrait: above the phone apps' caption and sound row (see SAFE)
      : Math.round(height * 0.1);
  const fontSize = usesBlurredStoryCard(project.settings)
    ? BLURRED_CARD.captionSize
    : sepia
    ? SEPIA.captionFont
    : paperMode
    ? Math.round(height * 0.026)
    : cardMode
    ? Math.round(height * 0.03)
    : style.preset === "focus"
      ? Math.round(height * 0.042)
      : style.preset === "minimal"
        ? Math.round(height * 0.029)
        : Math.round(height * 0.034);
  const card = usesStoryCard(project.settings);
  const outline = sepia ? SEPIA.captionOutline : style.preset === "minimal" ? 1 : 2;
  const borderStyle = card ? 1 : style.backgroundOpacity > 0 ? 3 : 1;
  const highlight = project.settings.captionHighlight === true;
  // Karaoke: words start in the caption colour (secondary) and switch to the highlight (primary) when spoken.
  // The sepia card has its own pale words, green spoken words and dark brown edge whatever the caption colours say.
  const unspoken = sepia ? SEPIA.captionPale : style.fontColor;
  const primary = highlight ? assColor(sepia ? SEPIA.captionSpoken : highlightColor(style.fontColor)) : assColor(unspoken);
  const edge = sepia ? SEPIA.captionEdge : style.outlineColor;
  // Explainer theme: a short key point held at the top for the whole scene (full-bleed only, clear of the subtitles below).
  const keyPoints = project.settings.showKeyPoints && !cardMode && !paperMode ? project.settings.keyPoints : [];
  const keyPointSize = Math.round(height * 0.05);
  const keyPointMarginV = Math.round(height * 0.12); // below the phone apps' top bar (see SAFE)
  let offset = 0;
  const lines: string[] = [];
  project.scenes.forEach((scene, index) => {
    for (const cue of scene.subtitles) {
      const text = highlight ? karaokeText(cue.text, cue.endMs - cue.startMs) : assEscape(cue.text);
      lines.push(
        `Dialogue: 0,${assTime(offset + cue.startMs)},${assTime(offset + cue.endMs)},Default,,0,0,0,,${text}`,
      );
    }
    const duration = scene.actualDurationMs ?? scene.estimatedDurationMs;
    const keyPoint = keyPoints[index]?.trim();
    if (keyPoint) {
      lines.push(
        `Dialogue: 1,${assTime(offset)},${assTime(offset + duration)},KeyPoint,,0,0,0,,${assEscape(keyPoint.toUpperCase())}`,
      );
    }
    offset += duration;
  });
  const keyPointStyle = keyPoints.some((point) => point.trim())
    ? `\nStyle: KeyPoint,${ASS_FONT},${keyPointSize},${assColor("#FFFFFF")},${assColor("#FFFFFF")},${assColor("#101828")},${assColor("#000000", 0.5)},-1,0,0,0,100,100,0,0,3,2,0,8,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${keyPointMarginV},1`
    : "";
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${ASS_FONT},${fontSize},${primary},${assColor(unspoken)},${assColor(edge)},${assColor(style.backgroundColor, 1 - style.backgroundOpacity)},-1,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment},${Math.round(width * 0.07)},${Math.round(width * 0.07)},${marginV},1${keyPointStyle}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
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
  const top = Math.round(height * (height > width ? 0.12 : 0.09)); // portrait: below the phone apps' top bar (see SAFE)
  return lineFiles.map((file, index) =>
    `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${size}:fontcolor=0xFFE14D:borderw=5:bordercolor=0x101010`
    + `:box=1:boxcolor=0x000000@0.38:boxborderw=14`
    + `:x=(w-text_w)/2:y=${top + index * Math.round(size * 1.3)}`
    + `:enable='lt(t,3)':alpha='if(lt(t,2.4),1,max(0,(3-t)/0.6))'`);
}

/** Persistent illustrated-story title: white lettering with the yellow glow used by the reference short. */
export function illustratedStoryTitleFilters(lineFiles: string[], lines: string[]): string[] {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const size = Math.max(44, Math.min(BLURRED_CARD.titleSize, Math.floor((CARD.width * 0.88) / (longest * 0.62))));
  return lineFiles.flatMap((file, index) => {
    const y = BLURRED_CARD.titleTop + index * CARD.titleLineGap;
    return [
      `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${size}:fontcolor=${BLURRED_CARD.titleGlow}:borderw=${BLURRED_CARD.titleGlowWidth}:bordercolor=${BLURRED_CARD.titleGlow}@0.8:shadowcolor=${BLURRED_CARD.titleGlow}@0.5:shadowx=0:shadowy=0:x=(w-text_w)/2:y=${y}`,
      `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${size}:fontcolor=0xFFFFFF:borderw=5:bordercolor=${BLURRED_CARD.titleEdge}:shadowcolor=0x000000@0.35:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${y}`,
    ];
  });
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
function firstFont(paths: string[]) {
  return paths.find((path) => existsSync(path)) ?? paths[0]!;
}

// The worker runs in both the Linux production container and on the Mac local
// media host. Keep the font configurable, but do not make story-card rendering
// depend on a Linux-only path.
const FONT_BOLD = process.env.CARD_FONT_BOLD || firstFont([
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
]);
const FONT_ITALIC = process.env.CARD_FONT_ITALIC || firstFont([
  "/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
  "/Library/Fonts/Arial Italic.ttf",
]);
const FONT_DIR = dirname(FONT_BOLD);
// Keep the logical family stable in ASS; fontconfig resolves it on both Linux
// and macOS, while drawtext uses the concrete cross-platform path above.
const ASS_FONT = "Noto Sans";
// ffmpeg filter arguments treat spaces and colons as syntax, unlike ordinary
// filesystem arguments. Escape only the characters needed by drawtext/fontsdir.
const filterFontPath = (path: string) => path.replace(/([\\:,' ])/gu, "\\$1");
const FONT_BOLD_FILTER = filterFontPath(FONT_BOLD);
const FONT_ITALIC_FILTER = filterFontPath(FONT_ITALIC);
const FONT_DIR_FILTER = filterFontPath(FONT_DIR);

/** Static story-card background: gradient + vignette + title banner + channel footer, rendered once per video. */
export async function buildCardFrame(config: WorkerConfig, workdir: string, project: Project): Promise<string> {
  const title = project.settings.cardTitle.trim() || project.suggestedTitle.trim() || fallbackCardTitle(project.sourceText);
  if (cardThemeOf(project.settings) === "sepia") return buildSepiaFrame(config, workdir, project, title);
  const lines = splitCardTitle(title.replace(/\s*\|\s*/gu, " "));
  const titleSize = cardTitleFontSize(lines);
  const textFile = async (name: string, text: string) => { const path = join(workdir, name); await writeFile(path, text, "utf8"); return path; };
  const draw: string[] = [];
  for (const [index, line] of lines.entries()) {
    const file = await textFile(`card-title-${index}.txt`, line);
    draw.push(`drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${titleSize}:fontcolor=${CARD.titleColor}:borderw=3:bordercolor=0x14202a:shadowcolor=0x000000@0.45:shadowx=3:shadowy=4:x=(w-text_w)/2:y=${CARD.titleTop + index * CARD.titleLineGap}`);
  }
  for (const [index, line] of cardFooterLines(project.settings.brandName).entries()) {
    const file = await textFile(`card-footer-${index}.txt`, line);
    draw.push(`drawtext=fontfile=${FONT_ITALIC_FILTER}:textfile=${file}:fontsize=${CARD.footerSize}:fontcolor=${CARD.footerColor}:borderw=1:bordercolor=0x14202a:x=(w-text_w)/2:y=${CARD.footerTop + index * 44}`);
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
    + `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${initialsFile}:fontsize=${Math.round(size * 0.4)}:fontcolor=${CARD.titleColor}:x=(w-text_w)/2:y=(h-text_h)/2-4[badge]`;
  await exec(config.FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", gradient, "-f", "lavfi", "-i", `color=c=black:s=${size}x${size}:d=1:r=1`,
    "-filter_complex", `${background};${badge};[bg][badge]overlay=(W-w)/2:${CARD.badgeY}:format=auto[out]`, "-map", "[out]", "-frames:v", "1", "-update", "1", frame],
    { timeout: 60_000 });
  return frame;
}

/** The sepia card: flat beige canvas, red kicker over a white title and an optional small footer. */
async function buildSepiaFrame(config: WorkerConfig, workdir: string, project: Project, title: string): Promise<string> {
  const lines = sepiaTitleLines(title);
  const textFile = async (name: string, text: string) => { const path = join(workdir, name); await writeFile(path, text, "utf8"); return path; };
  const draw: string[] = [];
  for (const [index, line] of lines.entries()) {
    const file = await textFile(`card-title-${index}.txt`, line);
    const kicker = lines.length > 1 && index === 0;
    const size = sepiaLineSize(line, kicker ? SEPIA.kickerSize : SEPIA.titleSize);
    draw.push(`drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${size}:fontcolor=${kicker ? SEPIA.kickerColor : SEPIA.titleColor}:borderw=${kicker ? 4 : 5}:bordercolor=${kicker ? SEPIA.kickerBorder : SEPIA.titleBorder}:x=(w-text_w)/2:y=${kicker ? SEPIA.kickerTop : lines.length > 1 ? SEPIA.titleTop : SEPIA.kickerTop + 60}`);
  }
  for (const [index, line] of cardFooterLines(project.settings.brandName).entries()) {
    const file = await textFile(`card-footer-${index}.txt`, line);
    draw.push(`drawtext=fontfile=${FONT_ITALIC_FILTER}:textfile=${file}:fontsize=${CARD.footerSize}:fontcolor=${SEPIA.footerColor}:x=(w-text_w)/2:y=${CARD.footerTop + index * 44}`);
  }
  const canvas = `color=c=${SEPIA.background}:s=${CARD.width}x${CARD.height}:d=1:r=1`;
  const background = `[0:v]format=rgb24${draw.length ? "," + draw.join(",") : ""}[bg]`;
  const frame = join(workdir, "card-frame.png");
  await exec(config.FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", canvas, "-filter_complex", `${background};[bg]null[out]`, "-map", "[out]", "-frames:v", "1", "-update", "1", frame], { timeout: 60_000 });
  return frame;
}

/**
 * The logo input's filter chain: scaled to `width`, optionally cut to a circle (for a round logo saved on a white or
 * coloured square, which would otherwise show as a box), then made as transparent as chosen.
 */
export function logoInputFilter(width: number, circle: boolean, opacity: number): string {
  if (!circle) return `scale=${width}:-1,format=rgba,colorchannelmixer=aa=${opacity}`;
  const c = width / 2;
  // 1.5% inside the edge, which trims the thin white rim such logos have; the alpha falls off over one pixel so the
  // edge is smooth instead of jagged.
  const r = +(c * 0.985).toFixed(2);
  return `crop='min(iw,ih)':'min(iw,ih)',scale=${width}:${width},format=rgba,`
    + `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${r}-hypot(X+0.5-${c},Y+0.5-${c})+0.5,0,1)',`
    + `colorchannelmixer=aa=${opacity}`;
}

/** The sepia card's default logo (no upload): a round badge with the channel's initials. Overlaid last, so it hangs over the picture band's corner. */
async function buildSepiaBadge(config: WorkerConfig, workdir: string, initials: string): Promise<string> {
  const size = SEPIA.badge;
  const centre = size / 2;
  const initialsFile = join(workdir, "card-badge.txt");
  await writeFile(initialsFile, initials, "utf8");
  const inside = `lte(hypot(X-${centre},Y-${centre}),${centre - 10})`;
  const filter = `format=rgba,geq=r='if(${inside},60,248)':g='if(${inside},48,240)':b='if(${inside},30,222)':a='if(lte(hypot(X-${centre},Y-${centre}),${centre - 2}),255,0)',`
    + `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${initialsFile}:fontsize=${Math.round(size * 0.4)}:fontcolor=0xF3E3B0:x=(w-text_w)/2:y=(h-text_h)/2-4`;
  const badge = join(workdir, "badge.png");
  await exec(config.FFMPEG_PATH, ["-y", "-f", "lavfi", "-i", `color=c=black:s=${size}x${size}:d=1:r=1`, "-vf", filter, "-frames:v", "1", "-update", "1", badge], { timeout: 60_000 });
  return badge;
}

export async function renderProject(
  config: WorkerConfig,
  project: Project,
  getFile: (path: string) => Promise<Uint8Array>,
  onProgress: (value: number, stage: string) => Promise<void>,
  /** Where scenes are drawn by hand; the load balancer spreads them over machines. Default: this machine's server. */
  options: { whiteboard?: WhiteboardRunner } = {},
): Promise<RenderFiles> {
  if (!project.scenes.length) throw new Error("Dự án chưa có cảnh");
  const orders = project.scenes.map((scene) => scene.order);
  if (orders.some((order) => !Number.isInteger(order) || order < 0) || new Set(orders).size !== orders.length)
    throw new Error("Scene orders must be unique non-negative integers");
  const workdir = await mkdtemp(join(tmpdir(), "short-video-"));
  try {
    const { width, height } = videoSize(project.settings.aspectRatio);
    const encoderPreset = videoEncoderPreset(project.settings.generationPreset);
    const blurredStoryCard = usesBlurredStoryCard(project.settings);
    const cardFrame = usesStoryCard(project.settings) && !blurredStoryCard ? await buildCardFrame(config, workdir, project) : null;
    const paperStage = usesPaperStage(project.settings);
    // One grain still for the whole video, written by the first scene that needs it (the seed is fixed anyway).
    let paperGrain: Promise<unknown> | null = null;
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
        await drawSceneByHand(config, scene, stillPath, size, ms, motionPath, options.whiteboard);
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
        paperCanvas = join(workdir, "paper-grain.png");
        paperGrain ??= exec(config.FFMPEG_PATH, paperGrainArgs(paperCanvas), { timeout: 60_000 });
        await paperGrain;
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
        : blurredStoryCard
        // Illustrated story: mirror the scene into a blurred canvas, then place the sharp 16:10 illustration on top.
        ? `[0:v]split=2[main][back];[back]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=luma_radius=${BLURRED_CARD.backgroundBlur}:luma_power=2:chroma_radius=12:chroma_power=2,eq=saturation=1.08:brightness=0.02[bg];[main]scale=${CARD.width * 2}:${CARD.bandH * 2}:force_original_aspect_ratio=increase,crop=${CARD.width * 2}:${CARD.bandH * 2}${monochrome},${clip ? `${clipFrames},scale=${CARD.width}:${CARD.bandH}:flags=lanczos` : `${motionFilter}:s=${CARD.width}x${CARD.bandH}:fps=30${sharpen}`}[band];[bg][band]overlay=0:${CARD.bandY},format=yuv420p[v]`
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
    } else if (usesStoryCard(project.settings) && cardThemeOf(project.settings) === "sepia" && brandInitials(project.settings.brandName)) {
      logoPath = await buildSepiaBadge(config, workdir, brandInitials(project.settings.brandName));
      args.push("-loop", "1", "-i", logoPath);
    }
    let musicPath: string | null = null;
    let musicVolume = project.settings.musicVolume;
    if (!project.settings.backgroundMusicPath && project.settings.autoMusic) {
      if (config.MUSICGEN_ENABLED) {
        try {
          const response = await fetch(`${config.LOCAL_MEDIA_BASE_URL.replace(/\/$/u, "")}/music`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt: `instrumental background music, no vocals, short-form video, ${project.settings.style}, ${project.scenes.slice(0, 2).map((scene) => scene.narration).join(" ").slice(0, 600)}`,
              duration: Math.ceil(total / 1000),
            }),
            signal: AbortSignal.timeout(300_000),
          });
          if (response.ok) {
            musicPath = join(workdir, "musicgen.wav");
            await writeFile(musicPath, new Uint8Array(await response.arrayBuffer()));
          }
        } catch {
          // Music is an enhancement, never a reason to fail an otherwise valid export.
        }
      }
      if (!musicPath) {
        musicPath = join(workdir, "ambient.wav");
        await exec(config.FFMPEG_PATH, buildAmbientMusicArgs(musicPath), { timeout: 60_000 });
      }
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
    const illustratedTitleFiles: string[] = [];
    let illustratedTitleLines: string[] = [];
    if (blurredStoryCard) {
      const title = (project.settings.cardTitle.trim() || project.suggestedTitle.trim() || fallbackCardTitle(project.sourceText)).replace(/\s*\|\s*/gu, " ");
      illustratedTitleLines = splitCardTitle(title);
      for (const [index, line] of illustratedTitleLines.entries()) {
        const file = join(workdir, `illustrated-title-${index}.txt`);
        await writeFile(file, line, "utf8");
        illustratedTitleFiles.push(file);
      }
    }
    const illustratedTitle = illustratedTitleFiles.length ? `${illustratedStoryTitleFilters(illustratedTitleFiles, illustratedTitleLines).join(",")},` : "";
    // Retention aids: a closing call to action faded in over the last seconds, and a thin bar that fills as the video plays.
    const cardLook = usesStoryCard(project.settings)
      ? cardThemeOf(project.settings) === "sepia" ? { fill: SEPIA.kickerColor, edge: SEPIA.kickerBorder }
        : cardThemeOf(project.settings) === "blurred" ? { fill: BLURRED_CARD.titleGlow, edge: BLURRED_CARD.titleEdge }
        : { fill: CARD.titleColor, edge: "0x14202a" }
      : { fill: "0xFFFFFF", edge: "0x000000" };
    const outro = project.settings.outroText.trim();
    let outroFilter = "";
    if (outro && total > 6000) {
      const file = join(workdir, "outro.txt");
      await writeFile(file, outro, "utf8");
      const from = Math.max(0, total / 1000 - 2.8).toFixed(3);
      const outroSize = Math.max(34, Math.min(58, Math.floor((width * 0.88) / (Math.max(1, [...outro].length) * 0.6))));
      outroFilter = `drawtext=fontfile=${FONT_BOLD_FILTER}:textfile=${file}:fontsize=${outroSize}:fontcolor=${cardLook.fill}:borderw=4:bordercolor=${cardLook.edge}:x=(w-text_w)/2:y=${usesStoryCard(project.settings) ? 1585 : Math.round(height * 0.68)}:alpha='min(1,(t-${from})/0.4)':enable='gte(t,${from})',`;
    }
    let filter = `[0:v]${project.settings.subtitle.enabled ? `subtitles=filename='${escapedAss}':fontsdir=${FONT_DIR_FILTER},` : ""}${illustratedTitle}${hook}${outroFilter}format=yuv420p[base]`;
    let baseLabel = "base";
    if (project.settings.progressBar) {
      const seconds = (total / 1000).toFixed(3);
      // Not on the very bottom edge: the phone app draws its own scrubber and navigation there. Under the picture band, or just above the app's bottom row.
      const barY = progressBarY(project.settings, width, height);
      filter += `;color=c=${cardLook.fill}:s=${width}x12:r=30:d=${seconds}[bar];[base][bar]overlay=x='-w+w*t/${seconds}':y=${barY}:eval=frame,format=yuv420p[withbar]`;
      baseLabel = "withbar";
    }
    if (logoPath) {
      // Uploaded logo: where and how big the person chose (packages/shared/src/logo.ts, the same rule as the studio
      // preview). The sepia card's own initials badge (no upload) keeps its spot on the picture band's corner.
      const opacity = project.settings.logoOpacity;
      let logoFilter: string;
      let at: { x: string; y: string };
      if (project.settings.logoPath) {
        const anchor = logoAnchor(project.settings, { width, height });
        at = logoOverlayXY(anchor);
        logoFilter = logoInputFilter(anchor.width, project.settings.logoShape === "circle", opacity);
      } else {
        at = { x: `W-w-${SEPIA.logoRight}`, y: `${SEPIA.logoTop}` };
        logoFilter = logoInputFilter(Math.round(width * Math.max(project.settings.logoScale, SEPIA.logoMinScale)), false, opacity);
      }
      filter += `;[1:v]${logoFilter}[logo];[${baseLabel}][logo]overlay=x=${at.x}:y=${at.y}:format=auto,format=yuv420p[v]`;
    } else {
      filter += `;[${baseLabel}]null[v]`;
    }
    const cutsMs: number[] = [];
    if (project.settings.sceneSfx) {
      let at = 0;
      for (const item of timelineScenes) { if (at > 0) cutsMs.push(at); at += item.actualDurationMs ?? item.estimatedDurationMs; }
    }
    filter += `;${buildAudioMixFilter(Boolean(musicPath), musicVolume, total, logoPath ? 2 : 1, true, cutsMs)}`;
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
    );
    await onProgress(78, "Đang ghép phụ đề và âm thanh");
    // Constant quality, capped so the file fits the storage limit; a first attempt that still comes out too large is redone lower.
    let rateScale = 1;
    for (let attempt = 0; ; attempt++) {
      await exec(config.FFMPEG_PATH, [...args, ...exportRateArgs(total, rateScale), output], {
        maxBuffer: 20_000_000,
        timeout: config.RENDER_TIMEOUT_MS ?? 900_000,
      });
      const size = (await stat(output)).size;
      if (size <= EXPORT_LIMIT_BYTES * 0.97) break;
      if (attempt >= 1) throw new Error(exportTooLargeMessage(total));
      rateScale = Math.max(0.3, (EXPORT_LIMIT_BYTES * 0.8) / size * rateScale);
    }
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
    const { stdout: outputProbeJson } = await exec(
      config.FFPROBE_PATH,
      [
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
        "-of", "json",
        output,
      ],
      { timeout: 30_000, maxBuffer: 2_000_000 },
    );
    const outputProbe = JSON.parse(outputProbeJson) as OutputProbe;
    const verifiedDuration = validateRenderedOutput(outputProbe, { width, height });
    await onProgress(94, "Đang tải bản xuất lên kho riêng tư");
    return {
      output,
      thumbnail,
      workdir,
      durationMs: Math.round(verifiedDuration * 1000),
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    if (error && typeof error === "object" && "stderr" in error) {
      const stderr = String(error.stderr ?? "").trim();
      if (stderr) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}: ${stderr.split("\\n").slice(-3).join(" | ")}`);
      }
    }
    throw error;
  }
}
