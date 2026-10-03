import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_PROJECT_SETTINGS,
  type Project,
  type Scene,
} from "@studio/shared";
import { createAss, renderProject } from "./render";

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const outputDir = join(process.cwd(), "tmp", "render-smoke");

async function makeAssets() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const commands = [
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=#315b78:s=1080x1920",
      "-frames:v",
      "1",
      "-update",
      "1",
      join(outputDir, "one.png"),
    ],
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=#b9624f:s=1080x1920",
      "-frames:v",
      "1",
      "-update",
      "1",
      join(outputDir, "two.png"),
    ],
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.8",
      "-q:a",
      "4",
      join(outputDir, "one.mp3"),
    ],
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=520:duration=2.2",
      "-q:a",
      "4",
      join(outputDir, "two.mp3"),
    ],
    [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=110:duration=5",
      "-q:a",
      "7",
      join(outputDir, "music.mp3"),
    ],
  ];
  for (const args of commands)
    await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

function scene(order: number, durationMs: number): Scene {
  return {
    id: crypto.randomUUID(),
    order,
    narration: order === 0 ? "Xin chào Việt Nam" : "Một phút sống chậm",
    imagePrompt: "Ảnh màu dùng kiểm thử",
    estimatedDurationMs: durationMs,
    actualDurationMs: durationMs,
    imagePath: order === 0 ? "one.png" : "two.png",
    audioPath: order === 0 ? "one.mp3" : "two.mp3",
    thumbnailUrl: null,
    mediaStatus: "ready",
    errorMessage: null,
    subtitles: [
      {
        id: crypto.randomUUID(),
        startMs: 100,
        endMs: durationMs - 100,
        text: order === 0 ? "Xin chào Việt Nam" : "Một phút sống chậm",
      },
    ],
  };
}

await makeAssets();
const project: Project = {
  id: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  title: "Smoke test render",
  sourceText: "Kiểm tra worker FFmpeg",
  inputMode: "full-script",
  hook: "",
  suggestedTitle: "",
  suggestedDescription: "",
  status: "rendering",
  settings: {
    ...DEFAULT_PROJECT_SETTINGS,
    backgroundMusicPath: "music.mp3",
    subtitle: { ...DEFAULT_PROJECT_SETTINGS.subtitle, enabled: true },
  },
  scenes: [scene(0, 1800), scene(1, 2200)],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const result = await renderProject(
  { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe } as never,
  project,
  (path) => readFile(join(outputDir, path)),
  async () => undefined,
);
try {
  const mp4 = join(outputDir, "smoke-output.mp4");
  const thumbnail = join(outputDir, "smoke-thumbnail.jpg");
  await copyFile(result.output, mp4);
  await copyFile(result.thumbnail, thumbnail);
  const { stdout } = await exec(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    mp4,
  ]);
  const probe = JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
    }>;
    format: { duration: string };
  };
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (
    !video ||
    video.codec_name !== "h264" ||
    video.width !== 1080 ||
    video.height !== 1920
  )
    throw new Error("Video stream không đúng preset dọc H.264");
  if (!audio || audio.codec_name !== "aac")
    throw new Error("Audio stream không phải AAC");
  if (!createAss(project).includes("Xin chào Việt Nam"))
    throw new Error("ASS không giữ được dấu tiếng Việt");
  process.stdout.write(
    `${JSON.stringify({ mp4, thumbnail, durationSeconds: Number(probe.format.duration), video: video.codec_name, audio: audio.codec_name, size: `${video.width}x${video.height}`, subtitleAssUtf8: true }, null, 2)}\n`,
  );
} finally {
  await rm(result.workdir, { recursive: true, force: true });
}
