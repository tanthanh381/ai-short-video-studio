import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@studio/shared";
import { drawsByHand } from "@studio/shared";
import type { WorkerConfig } from "./config";
import { WHITEBOARD_DOWN, autoAnnotation, drawSceneByHand, withoutDrawingHand } from "./whiteboard";

const config = { WHITEBOARD_SERVER_URL: "http://wb.test:8766/", RENDER_TIMEOUT_MS: 5_000 } as WorkerConfig;
const scene = (annotationJson: unknown = null) => ({ id: "s1", order: 2, annotationJson }) as Scene;

describe("hand-drawn scenes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only the whiteboard look is drawn by hand", () => {
    expect(drawsByHand({ visualPreset: "whiteboard" })).toBe(true);
    expect(drawsByHand({ visualPreset: "cartoon" })).toBe(false);
  });

  it("keeps a drawing hand out of the picture, since the renderer adds its own", () => {
    // Scene 7 of the first QA video: the writer put the marker into the picture.
    expect(withoutDrawingHand("Close-up of chopsticks resting on a white plate, holding small pieces of fish. A hand in the foreground holds a marker, drawing bold outlines."))
      .toBe("Close-up of chopsticks resting on a white plate, holding small pieces of fish.");
    expect(withoutDrawingHand("Elderly hands holding chopsticks over a bowl of rice, warm light"))
      .toBe("Elderly hands holding chopsticks over a bowl of rice, warm light");
    expect(withoutDrawingHand("A pen drawing a tree")).toBe("A pen drawing a tree");
  });

  it("draws the whole picture in the first 70% of the scene, then holds it", () => {
    const annotation = autoAnnotation("s1", 1080, 1920, 6000);
    expect(annotation.canvas).toEqual({ width: 1080, height: 1920 });
    expect(annotation.elements).toHaveLength(1);
    expect(annotation.elements[0]!.region).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(annotation.elements[0]!.reveal.durationMs).toBe(4200);
  });

  it("sends the still at output size with the scene's own regions when it has them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-test-"));
    try {
      const still = join(dir, "still.png");
      await writeFile(still, "png");
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(new Uint8Array([1, 2, 3]));
      }));
      const custom = { canvas: { width: 576, height: 1024 }, elements: [{ id: "a" }] };
      await drawSceneByHand(config, scene(custom), still, { width: 1080, height: 1920 }, 5000, join(dir, "a.mp4"));
      await drawSceneByHand(config, scene(), still, { width: 1080, height: 1920 }, 5000, join(dir, "b.mp4"));
      expect(calls[0]!.url).toBe("http://wb.test:8766/render");
      expect(calls[0]!.body).toMatchObject({ annotation: custom, total_ms: 5000, cap_long_edge: 1920, hand_height: 493, image_b64: Buffer.from("png").toString("base64") });
      await drawSceneByHand(config, scene(), still, { width: 1080, height: 675 }, 5000, join(dir, "c.mp4"));
      expect(calls[2]!.body).toMatchObject({ cap_long_edge: 1080, hand_height: 308 });
      expect(calls[1]!.body.annotation).toMatchObject({ sceneId: "s1", canvas: { width: 1080, height: 1920 } });
      expect([...await readFile(join(dir, "a.mp4"))]).toEqual([1, 2, 3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explains in Vietnamese when the drawing machine is off or fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-test-"));
    try {
      const still = join(dir, "still.png");
      await writeFile(still, "png");
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
      await expect(drawSceneByHand(config, scene(), still, { width: 1080, height: 1920 }, 5000, join(dir, "x.mp4"))).rejects.toThrow(WHITEBOARD_DOWN);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("Traceback\nValueError: no elements", { status: 500 })));
      await expect(drawSceneByHand(config, scene(), still, { width: 1080, height: 1920 }, 5000, join(dir, "x.mp4"))).rejects.toThrow("Máy vẽ tay lỗi ở cảnh 3: Traceback ValueError: no elements");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
