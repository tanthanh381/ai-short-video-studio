import { readFile, writeFile } from "node:fs/promises";
import type { Scene } from "@studio/shared";
import type { WorkerConfig } from "./config";

export const WHITEBOARD_DOWN =
  "Máy vẽ tay (cổng 8766) chưa chạy trên máy mini. Hãy mở lại máy tạo video, hoặc chọn phong cách hình ảnh khác rồi bấm Tiếp tục.";

/**
 * Told to the storyboard writer instead of the preset's description ("Bàn tay vẽ từng nét…"): that wording made it
 * put a hand holding a marker into the picture, and the renderer's own hand then drew a second one over it.
 */
export const WHITEBOARD_STORYBOARD_STYLE =
  "simple whiteboard doodle illustration, bold black outlines, flat colors, plain white background; the drawing hand is added later, so never put hands, pens or markers in the picture";

const DRAWING_HAND = /\b(?:hands?|fingers?)\b[^,.;]*\b(?:markers?|pens?|pencils?|draw(?:s|ing)?|sketch(?:es|ing)?)\b|\b(?:markers?|pens?|pencils?)\b[^,.;]*\bdraw/iu;

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

/** Share of the scene spent drawing; the finished picture stays on screen for the rest. */
const DRAW_SHARE = 0.7;

/**
 * One region covering the whole picture. The renderer still follows the strokes inside it (outlines first, then the
 * flat colours), so a scene needs no hand-made annotation; one from the region editor replaces this when present.
 */
export function autoAnnotation(sceneId: string, width: number, height: number, sceneMs: number) {
  return {
    sceneId,
    canvas: { width, height },
    sceneDurationMs: sceneMs,
    elements: [
      {
        id: "auto-scene",
        label: "Toàn cảnh",
        sequence: 1,
        narrativeRole: "scene",
        subtitle: "",
        type: "scene",
        region: { x: 0, y: 0, width, height },
        reveal: {
          direction: "top_to_bottom",
          startMs: 0,
          durationMs: Math.round(sceneMs * DRAW_SHARE),
          maskPaddingPx: 0,
          protectedRegions: [],
        },
        handPath: { start: [Math.round(width / 2), 0], end: [Math.round(width / 2), height], easing: "easeInOut" },
      },
    ],
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
): Promise<void> {
  const annotation = (scene.annotationJson as object | null) ?? autoAnnotation(scene.id, size.width, size.height, sceneMs);
  let response: Response;
  try {
    response = await fetch(`${config.WHITEBOARD_SERVER_URL.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: (await readFile(stillPath)).toString("base64"),
        annotation,
        total_ms: sceneMs,
        fps: 30,
        cap_long_edge: Math.max(size.width, size.height),
        // The hand is sized for a 1080-wide frame; the story card's picture band is shorter, so shrink it with the band.
        hand_height: Math.round(HAND_HEIGHT_1080 * Math.min(size.width, size.height) / 1080),
      }),
      signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS ?? 900_000),
    });
  } catch {
    throw new Error(WHITEBOARD_DOWN);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().split("\n").slice(-2).join(" ").slice(0, 300);
    throw new Error(`Máy vẽ tay lỗi ở cảnh ${scene.order + 1}${detail ? `: ${detail}` : ""}`);
  }
  await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}
