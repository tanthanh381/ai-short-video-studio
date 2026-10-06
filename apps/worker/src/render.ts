import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Project, Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { buildAudioMixFilter, validateCaptionTiming } from "./render-quality";

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
  const alignment =
    style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const marginV =
    style.position === "bottom"
      ? Math.round(height * 0.16)
      : Math.round(height * 0.1);
  const fontSize =
    style.preset === "focus"
      ? Math.round(height * 0.042)
      : style.preset === "minimal"
        ? Math.round(height * 0.029)
        : Math.round(height * 0.034);
  const outline = style.preset === "minimal" ? 1 : 2;
  const borderStyle = style.backgroundOpacity > 0 ? 3 : 1;
  let offset = 0;
  const lines: string[] = [];
  for (const scene of project.scenes) {
    for (const cue of scene.subtitles) {
      lines.push(
        `Dialogue: 0,${assTime(offset + cue.startMs)},${assTime(offset + cue.endMs)},Default,,0,0,0,,${assEscape(cue.text)}`,
      );
    }
    offset += scene.actualDurationMs ?? scene.estimatedDurationMs;
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,${fontSize},${assColor(style.fontColor)},${assColor(style.fontColor)},${assColor(style.outlineColor)},${assColor(style.backgroundColor, 1 - style.backgroundOpacity)},-1,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment},${Math.round(width * 0.07)},${Math.round(width * 0.07)},${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
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
    const segments: string[] = [];
    const timelineScenes: Scene[] = [];
    let done = 0;
    for (const scene of project.scenes) {
      if (!scene.imagePath || !scene.audioPath)
        throw new Error(`Cảnh ${scene.order + 1} chưa có đủ ảnh và giọng đọc`);
      const imagePath = join(workdir, `scene-${scene.order}.png`);
      const audioPath = join(workdir, `scene-${scene.order}.mp3`);
      const segmentPath = join(workdir, `scene-${scene.order}.mkv`);
      await writeFile(imagePath, await getFile(scene.imagePath));
      await writeFile(audioPath, await getFile(scene.audioPath));
      const ms = await durationMs(config, audioPath);
      if (project.settings.subtitle.enabled) validateCaptionTiming(scene, ms);
      scene.actualDurationMs = ms;
      const seconds = ms / 1000;
      // Straight cuts preserve measured timing and avoid a black opening/boundaries.
      const monochrome = project.settings.visualPreset === "ink-monochrome" ? ",hue=s=0,eq=contrast=1.04:brightness=0.01" : "";
      const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${monochrome},zoompan=z='min(max(zoom,pzoom)+0.00035,1.06)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=30,format=yuv420p[v]`;
      await exec(
        config.FFMPEG_PATH,
        [
          "-y",
          "-loop",
          "1",
          "-framerate",
          "30",
          "-i",
          imagePath,
          "-i",
          audioPath,
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
    if (project.settings.backgroundMusicPath) {
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
      const x = project.settings.logoPosition.endsWith("right") ? `W-w-${margin}` : `${margin}`;
      const y = project.settings.logoPosition.startsWith("bottom") ? `H-h-${margin}` : `${margin}`;
      const logoWidth = Math.round(width * project.settings.logoScale);
      filter += `;[1:v]scale=${logoWidth}:-1:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${project.settings.logoOpacity}[logo];[base][logo]overlay=x=${x}:y=${y}:format=auto[v]`;
    } else {
      filter += ";[base]null[v]";
    }
    filter += `;${buildAudioMixFilter(Boolean(musicPath), project.settings.musicVolume, total, logoPath ? 2 : 1)}`;
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
