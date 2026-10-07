import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, Scene } from "@studio/shared";
import { createAss, durationMs, videoEncoderPreset, videoSize } from "./render";
import type { WorkerConfig } from "./config";

const exec = promisify(execFile);

export type WhiteboardDeps = {
  config: WorkerConfig;
  db: SupabaseClient;
  download: (path: string) => Promise<Uint8Array>;
  upload: (path: string, data: Uint8Array, contentType: string) => Promise<void>;
  updateProject: (id: string, values: Record<string, unknown>) => Promise<void>;
  updateScene: (id: string, values: Record<string, unknown>) => Promise<void>;
  setProgress: (id: string, progress: number, stage: string) => Promise<void>;
  checkDeadline: () => void;
};

function generateAutoAnnotation(
  sceneId: string,
  imgW: number,
  imgH: number,
  sceneDurationMs: number,
  aspectRatio: string,
) {
  const drawMs = Math.round(sceneDurationMs * 0.7);
  const direction = aspectRatio === "16:9" ? "left_to_right" : "top_to_bottom";
  const handStart: [number, number] =
    direction === "left_to_right"
      ? [0, Math.round(imgH / 2)]
      : [Math.round(imgW / 2), 0];
  const handEnd: [number, number] =
    direction === "left_to_right"
      ? [imgW, Math.round(imgH / 2)]
      : [Math.round(imgW / 2), imgH];
  return {
    sceneId,
    canvas: { width: imgW, height: imgH },
    sceneDurationMs,
    storyBasis: "Tự động tạo vùng vẽ — mở editor để chỉnh chi tiết",
    elements: [
      {
        id: "auto-scene",
        label: "Toàn cảnh",
        sequence: 1,
        narrativeRole: "scene",
        subtitle: "",
        type: "scene",
        region: { x: 0, y: 0, width: imgW, height: imgH },
        reveal: {
          direction,
          startMs: 0,
          durationMs: drawMs,
          maskPaddingPx: 0,
          protectedRegions: [],
        },
        handPath: { start: handStart, end: handEnd, easing: "easeInOut" },
      },
    ],
  };
}

async function getImageDimensions(
  config: WorkerConfig,
  imagePath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await exec(
    config.FFPROBE_PATH,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      imagePath,
    ],
    { timeout: 15_000 },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
  };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream.height)
    throw new Error("Không đọc được kích thước ảnh");
  return { width: stream.width, height: stream.height };
}

export async function renderWhiteboardVideo(
  jobId: string,
  project: Project,
  deps: WhiteboardDeps,
): Promise<void> {
  const { config, db, download, upload, updateProject, updateScene, setProgress, checkDeadline } = deps;

  const readyScenes = project.scenes.filter((s) => s.imagePath);
  if (!readyScenes.length)
    throw new Error("Chưa có cảnh nào có ảnh để render video vẽ tay. Hãy tạo ảnh cho ít nhất một cảnh trước.");
  const scenesWithoutAudio = readyScenes.filter((s) => !s.audioPath);
  if (scenesWithoutAudio.length)
    throw new Error(
      `${scenesWithoutAudio.length} cảnh chưa có giọng đọc (cảnh ${scenesWithoutAudio.map((s) => s.order + 1).join(", ")}). Hãy tạo giọng đọc trước.`,
    );

  await updateProject(project.id, { status: "rendering" });
  await setProgress(jobId, 2, "Đang chuẩn bị render video vẽ tay");

  const workdir = await mkdtemp(join(tmpdir(), "whiteboard-"));
  const { width, height } = videoSize(project.settings.aspectRatio);
  const encoderPreset = videoEncoderPreset(project.settings.generationPreset);
  const segments: string[] = [];
  const timelineScenes: Scene[] = [];
  let done = 0;

  try {
    for (const scene of readyScenes) {
      checkDeadline();
      const pct = Math.round(5 + (done / readyScenes.length) * 72);
      await setProgress(jobId, pct, `Đang render cảnh ${done + 1}/${readyScenes.length}`);

      // Download image
      const imageData = await download(scene.imagePath!);
      const imgTmpPath = join(workdir, `img-${scene.order}.png`);
      await writeFile(imgTmpPath, imageData);

      // Image dimensions
      let imgW = width;
      let imgH = height;
      try {
        const dims = await getImageDimensions(config, imgTmpPath);
        imgW = dims.width;
        imgH = dims.height;
      } catch {
        // fall back to project dimensions
      }

      // Annotation
      const totalMs = scene.actualDurationMs ?? scene.estimatedDurationMs;
      const annotation =
        (scene.annotationJson as object | null) ??
        generateAutoAnnotation(scene.id, imgW, imgH, totalMs, project.settings.aspectRatio);

      // Call whiteboard render server
      const imageB64 = Buffer.from(imageData).toString("base64");
      const wbRes = await fetch(`${config.WHITEBOARD_SERVER_URL}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imageB64, annotation, total_ms: totalMs }),
        signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS),
      });
      if (!wbRes.ok) {
        const errText = await wbRes.text().catch(() => "unknown");
        throw new Error(
          `Whiteboard server lỗi cảnh ${scene.order + 1}: ${wbRes.status} ${errText}`,
        );
      }
      const wbMp4Data = new Uint8Array(await wbRes.arrayBuffer());
      const wbVideoPath = join(workdir, `wb-${scene.order}.mp4`);
      await writeFile(wbVideoPath, wbMp4Data);

      // Download audio
      const audioData = await download(scene.audioPath!);
      const audioTmpPath = join(workdir, `audio-${scene.order}.mp3`);
      await writeFile(audioTmpPath, audioData);

      // Mux whiteboard video + audio
      const segmentPath = join(workdir, `segment-${scene.order}.mkv`);
      await exec(
        config.FFMPEG_PATH,
        [
          "-y",
          "-i", wbVideoPath,
          "-i", audioTmpPath,
          "-c:v", "libx264",
          "-preset", encoderPreset,
          "-crf", "22",
          "-c:a", "pcm_s16le",
          "-ar", "48000",
          "-shortest",
          segmentPath,
        ],
        { timeout: config.RENDER_TIMEOUT_MS, maxBuffer: 100_000_000 },
      );

      const segDuration = await durationMs(config, segmentPath);
      timelineScenes.push({ ...scene, actualDurationMs: segDuration });
      segments.push(segmentPath);
      done++;
    }

    // Concat
    await setProgress(jobId, 80, "Đang ghép cảnh");
    const concatList = join(workdir, "concat.txt");
    await writeFile(
      concatList,
      segments
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join("\n"),
    );
    const basePath = join(workdir, "base.mkv");
    await exec(
      config.FFMPEG_PATH,
      ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", basePath],
      { timeout: config.RENDER_TIMEOUT_MS },
    );

    // Subtitles
    await setProgress(jobId, 88, "Đang đốt phụ đề");
    const assPath = join(workdir, "subtitles.ass");
    await writeFile(assPath, createAss({ ...project, scenes: timelineScenes }), "utf8");
    const outputPath = join(workdir, "output.mp4");
    const escapedAss = assPath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    const videoFilter = `${
      project.settings.subtitle.enabled
        ? `subtitles=filename='${escapedAss}':fontsdir=/usr/share/fonts/truetype/noto,`
        : ""
    }format=yuv420p`;
    await exec(
      config.FFMPEG_PATH,
      [
        "-y",
        "-i", basePath,
        "-vf", videoFilter,
        "-c:v", "libx264",
        "-preset", encoderPreset,
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        outputPath,
      ],
      { timeout: config.RENDER_TIMEOUT_MS, maxBuffer: 100_000_000 },
    );

    // Thumbnail
    const thumbPath = join(workdir, "thumb.jpg");
    await exec(
      config.FFMPEG_PATH,
      ["-y", "-ss", "1", "-i", outputPath, "-frames:v", "1", "-q:v", "5", thumbPath],
      { timeout: 30_000 },
    ).catch(() => undefined);

    const totalDuration = await durationMs(config, outputPath);
    await setProgress(jobId, 95, "Đang tải lên");

    const outStoragePath = `${project.userId}/${project.id}/exports/${jobId}.mp4`;
    const thumbStoragePath = `${project.userId}/${project.id}/exports/${jobId}.jpg`;
    await upload(outStoragePath, new Uint8Array(await readFile(outputPath)), "video/mp4");
    try {
      await upload(thumbStoragePath, new Uint8Array(await readFile(thumbPath)), "image/jpeg");
    } catch {
      // thumbnail is optional
    }

    const { error: exportError } = await db.from("exports").upsert(
      {
        project_id: project.id,
        job_id: jobId,
        storage_path: outStoragePath,
        thumbnail_path: thumbStoragePath,
        duration_ms: totalDuration,
        width,
        height,
        status: "completed",
      },
      { onConflict: "job_id" },
    );
    if (exportError) throw exportError;

    for (const scene of timelineScenes)
      await updateScene(scene.id, { actual_duration_ms: scene.actualDurationMs });

    await updateProject(project.id, { status: "completed" });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
