import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Project, Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { buildAudioMixFilter, buildAmbientMusicArgs, validateCaptionTiming } from "./render-quality";
import { CARD, brandInitials, cardFooterLines, cardTitleFontSize, fallbackCardTitle, splitCardTitle, usesStoryCard } from "./card-layout";

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
  // Story card: captions sit directly under the picture band, top-anchored, in a calmer size.
  const alignment = cardMode ? 8 : style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const marginV = cardMode
    ? CARD.subtitleTop
    : style.position === "bottom"
      ? Math.round(height * 0.16)
      : Math.round(height * 0.1);
  const fontSize = cardMode
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

/**
 * Slow push-in on a still. A scene held longer than 6.5 s gets a punch-in cut halfway: a closer framing on the
 * upper middle (where faces usually are), so the picture changes every 3-6 s without generating another image.
 */
export function sceneMotion(seconds: number): string {
  if (seconds <= 6.5) return "zoompan=z='min(max(zoom,pzoom)+0.00035,1.06)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1";
  const cut = Math.round((seconds * 30) / 2);
  return `zoompan=z='if(lt(on,${cut}),min(1+0.00035*on,1.06),min(1.22+0.0003*(on-${cut}),1.3))'`
    + `:x='iw/2-iw/zoom/2':y='if(lt(on,${cut}),ih/2-ih/zoom/2,(ih-ih/zoom)*0.3)':d=1`;
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
    const segments: string[] = [];
    const timelineScenes: Scene[] = [];
    let done = 0;
    for (const scene of project.scenes) {
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
      const motionFilter = sceneMotion(seconds);
      const filter = cardFrame
        // Story card: the picture lives in a 16:10 band over the pre-rendered background (input 2).
        ? scene.videoPath
          ? `[0:v]scale=${CARD.width}:${CARD.bandH}:force_original_aspect_ratio=increase,crop=${CARD.width}:${CARD.bandH},fps=30,format=yuv420p[band];[2:v]format=yuv420p[bg];[bg][band]overlay=0:${CARD.bandY},format=yuv420p[v]`
          : `[0:v]scale=${CARD.width}:${CARD.bandH}:force_original_aspect_ratio=increase,crop=${CARD.width}:${CARD.bandH}${monochrome},${motionFilter}:s=${CARD.width}x${CARD.bandH}:fps=30[band];[2:v]format=yuv420p[bg];[bg][band]overlay=0:${CARD.bandY},format=yuv420p[v]`
        : scene.videoPath
          ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p[v]`
          : `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${monochrome},${motionFilter}:s=${width}x${height}:fps=30,format=yuv420p[v]`;
      const videoInput = scene.videoPath ? ["-stream_loop", "-1", "-i", motionPath] : ["-loop", "1", "-framerate", "30", "-i", imagePath];
      await exec(
        config.FFMPEG_PATH,
        [
          "-y",
          ...videoInput,
          "-i",
          audioPath,
          ...(cardFrame ? ["-loop", "1", "-framerate", "30", "-i", cardFrame] : []),
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
          "-preset",
          encoderPreset,
          "-crf",
          "22",
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
      timelineScenes.push({ ...scene, actualDurationMs: await durationMs(config, segmentPath) });
      segments.push(segmentPath);
      done++;
      await onProgress(
        15 + Math.round((done / project.scenes.length) * 55),
        `Đã dựng cảnh ${done}/${project.scenes.length}`,
      );
    }
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
    let filter = `[0:v]${project.settings.subtitle.enabled ? `subtitles=filename='${escapedAss}':fontsdir=/usr/share/fonts/truetype/noto,` : ""}format=yuv420p[base]`;
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
    await exec(
      config.FFMPEG_PATH,
      [
        "-y",
        "-ss",
        Math.min(0.5, total / 2000).toFixed(3),
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
