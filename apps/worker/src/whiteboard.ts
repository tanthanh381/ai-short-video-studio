import { readFile, writeFile } from "node:fs/promises";
import type { Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { NodeHttpError } from "./node-errors";
import type { ImageQualityAudit } from "./ollama";

export const WHITEBOARD_DOWN =
  "Máy vẽ tay (cổng 8766) chưa chạy trên máy mini. Hãy mở lại máy tạo video, hoặc chọn phong cách hình ảnh khác rồi bấm Tiếp tục.";

/**
 * Told to the storyboard writer instead of the preset's description ("Bàn tay vẽ từng nét…"): that wording made it
 * put a hand holding a marker into the picture, and the renderer's own hand then drew a second one over it.
 */
export const WHITEBOARD_STORYBOARD_STYLE =
  "simple whiteboard doodle illustration, bold black outlines, flat colors, plain white background; arrange 3 or 4 separate visual groups in narration order with clear empty gutters between them, left-to-right for landscape or top-to-bottom for portrait; no overlapping groups; illustrate only the story subjects and objects, never an artist or the act of drawing; the renderer adds its own drawing hand later, so no drawing hand, pen, pencil, marker, stylus, handwritten words, letters, logos or pseudo-text anywhere in the picture";

const DRAWING_HAND = /\b(?:hands?|fingers?)\b[^,.;]*\b(?:markers?|pens?|pencils?|draw(?:s|ing)?|sketch(?:es|ing)?)\b|\b(?:markers?|pens?|pencils?)\b[^,.;]*\bdraw/iu;

const DRAWING_TOOL = /\b(?:pen|pencil|marker|stylus|drawing tablet)\b/iu;
const DRAWING_ACTION = /\b(?:drawing|writing|sketching)\s+(?:hand|pen|pencil|marker|stylus)\b|\bhand\s+(?:holding|using)\s+(?:a\s+)?(?:pen|pencil|marker|stylus)\b/iu;

/** A whiteboard source picture must not contain the artist layer that the renderer adds later. */
export function whiteboardAuditClean(audit: ImageQualityAudit | null): boolean {
  return !!audit
    && audit.textArtifacts === "none"
    && !audit.props.some((prop) => DRAWING_TOOL.test(prop))
    && !DRAWING_ACTION.test(audit.reason);
}

/**
 * Drops the part of an image prompt that describes a hand drawing the picture (see WHITEBOARD_STORYBOARD_STYLE): from
 * the first clause naming it to the end of that sentence, since the clauses after it go on describing the drawing.
 */
export function withoutDrawingHand(prompt: string): string {
  const sentences = prompt.split(/(?<=[.;])\s+/u).map((sentence) => {
    const clauses = sentence.split(/(?<=,)\s+/u);
    const hand = clauses.findIndex((clause) => DRAWING_HAND.test(clause));
    if (hand < 0) return sentence;
    return clauses.slice(0, hand).join(" ").replace(/,\s*$/u, ".");
  });
  return sentences.filter(Boolean).join(" ").trim() || prompt;
}

const HAND_HEIGHT_1080 = 493;

/**
 * Automatic, deterministic regions for generated whiteboard art. The image prompt deliberately asks the image model
 * for separated narrative groups, so these reading-order bands hide every later group until its turn. A hand-edited
 * annotation still wins when present.
 */
export function autoAnnotation(
  sceneId: string,
  width: number,
  height: number,
  sceneMs: number,
  narration = "",
  subtitles: Scene["subtitles"] = [],
) {
  const cueText = subtitles
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue) => cue.text.trim())
    .filter(Boolean);
  const clauses = narration.split(/(?<=[.!?…;:])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
  const labels = cueText.length ? cueText : clauses;
  const regionCount = Math.min(4, Math.max(2, labels.length || 3));
  const vertical = height > width;
  const drawMs = Math.max(600, Math.round(sceneMs * 0.78));
  const eachMs = Math.max(250, Math.floor(drawMs / regionCount));
  const elements = Array.from({ length: regionCount }, (_, index) => {
    const first = vertical ? Math.round((height * index) / regionCount) : Math.round((width * index) / regionCount);
    const last = vertical ? Math.round((height * (index + 1)) / regionCount) : Math.round((width * (index + 1)) / regionCount);
    const region = vertical
      ? { x: 0, y: first, width, height: Math.max(1, last - first) }
      : { x: first, y: 0, width: Math.max(1, last - first), height };
    const centerX = Math.round(region.x + region.width / 2);
    const centerY = Math.round(region.y + region.height / 2);
    return {
      id: `auto-region-${index + 1}`,
      label: labels[index] ?? `Ý ${index + 1}`,
      sequence: index + 1,
      narrativeRole: "narration-beat",
      subtitle: labels[index] ?? "",
      type: "scene",
      region,
      reveal: {
        direction: vertical ? "top_to_bottom" as const : "left_to_right" as const,
        startMs: index * eachMs,
        durationMs: index === regionCount - 1 ? Math.max(250, drawMs - index * eachMs) : eachMs,
        maskPaddingPx: 0,
        protectedRegions: [],
      },
      handPath: vertical
        ? { start: [centerX, region.y] as [number, number], end: [centerX, region.y + region.height] as [number, number], easing: "easeInOut" }
        : { start: [region.x, centerY] as [number, number], end: [region.x + region.width, centerY] as [number, number], easing: "easeInOut" },
    };
  });
  return {
    sceneId,
    canvas: { width, height },
    sceneDurationMs: sceneMs,
    elements,
  };
}

export async function whiteboardReady(config: WorkerConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.WHITEBOARD_SERVER_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2_500) });
    return response.ok;
  } catch {
    return false;
  }
}

export type WhiteboardTarget = { url: string; token?: string | undefined };
/** Runs `work` against one hand-drawing server; the load balancer picks which machine's. */
export type WhiteboardRunner = <R>(work: (target: WhiteboardTarget) => Promise<R>) => Promise<R>;

/**
 * Draws one scene by hand. `stillPath` is already cropped to the segment's size, so the server draws at full output
 * resolution and a region annotation (made on the original picture) scales with it.
 */
export async function drawSceneByHand(
  config: WorkerConfig,
  scene: Scene,
  stillPath: string,
  size: { width: number; height: number },
  sceneMs: number,
  outputPath: string,
  run: WhiteboardRunner = (work) => work({ url: config.WHITEBOARD_SERVER_URL }),
): Promise<void> {
  const annotation = (scene.annotationJson as object | null)
    ?? autoAnnotation(scene.id, size.width, size.height, sceneMs, scene.narration, scene.subtitles);
  const body = JSON.stringify({
    image_b64: (await readFile(stillPath)).toString("base64"),
    annotation,
    total_ms: sceneMs,
    fps: 30,
    cap_long_edge: Math.max(size.width, size.height),
    // The hand is sized for a 1080-wide frame; the story card's picture band is shorter, so shrink it with the band.
    hand_height: Math.round(HAND_HEIGHT_1080 * Math.min(size.width, size.height) / 1080),
  });
  const video = await run(async (target) => {
    let response: Response;
    try {
      response = await fetch(`${target.url.replace(/\/$/, "")}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}) },
        body,
        signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS ?? 900_000),
      });
    } catch {
      // Not reachable: the same words as before, but marked so the load balancer can hand the scene to another machine.
      throw new NodeHttpError(WHITEBOARD_DOWN, 503);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().split("\n").slice(-2).join(" ").slice(0, 300);
      throw new NodeHttpError(`Máy vẽ tay lỗi ở cảnh ${scene.order + 1}${detail ? `: ${detail}` : ""}`, response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  });
  await writeFile(outputPath, video);
}
