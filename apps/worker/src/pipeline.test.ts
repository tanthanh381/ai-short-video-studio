import { describe, expect, it, vi } from "vitest";
import { projectSchema, sceneSchema } from "@studio/shared";
import { pipelineCheckpoint, runVideoPipeline, sceneMediaReady, type PipelineCheckpoint } from "./pipeline";

function fixture() {
  const project = projectSchema.parse({
    id: crypto.randomUUID(), userId: crypto.randomUUID(), title: "Một ngày mới",
    sourceText: "Hãy dành một phút lắng nghe chính mình.", inputMode: "full-script",
    status: "queued", settings: { textProvider: "ollama", mediaProvider: "local" },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scenes: [],
  });
  const steps: string[] = [];
  const checkpoints: PipelineCheckpoint[] = [];
  const pending = sceneSchema.parse({
    id: crypto.randomUUID(), order: 0, narration: project.sourceText,
    imagePrompt: "A quiet Vietnamese morning", estimatedDurationMs: 9000,
  });
  const actions = {
    getProject: vi.fn(async () => project),
    storyboard: vi.fn(async () => { steps.push("storyboard"); project.scenes = [pending]; }),
    media: vi.fn(async () => {
      steps.push("media");
      for (const scene of project.scenes) {
        scene.imagePath = "image.png"; scene.audioPath = "speech.wav";
        scene.actualDurationMs = 4210; scene.mediaStatus = "ready";
        scene.subtitles = [{ id: crypto.randomUUID(), startMs: 0, endMs: 4210, text: scene.narration }];
      }
    }),
    render: vi.fn(async () => { steps.push("render"); }),
    checkpoint: vi.fn(async (value: PipelineCheckpoint) => { checkpoints.push(value); }),
    progress: vi.fn(async () => undefined),
  };
  return { project, pending, steps, checkpoints, actions };
}

describe("durable one-click pipeline", () => {
  it("runs storyboard, media, render in sequence and saves each boundary", async () => {
    const f = fixture();
    await runVideoPipeline({}, f.actions);
    expect(f.steps).toEqual(["storyboard", "media", "render"]);
    expect(f.checkpoints.map((c) => c.step)).toEqual(["media", "render", "complete"]);
    expect(f.project.scenes[0]!.actualDurationMs).toBe(4210);
  });

  it("does not render after media fails, preserving the media checkpoint", async () => {
    const f = fixture();
    f.actions.media.mockImplementation(async () => { throw new Error("ComfyUI unavailable"); });
    await expect(runVideoPipeline({}, f.actions)).rejects.toThrow("ComfyUI unavailable");
    expect(f.actions.render).not.toHaveBeenCalled();
    expect(f.checkpoints.map((c) => c.step)).toEqual(["media"]);
    expect(f.project.scenes).toHaveLength(1);
  });

  it("retry keeps ready scenes and skips successful storyboard/media", async () => {
    const f = fixture();
    f.project.scenes = [f.pending];
    await f.actions.media();
    f.steps.length = 0;
    f.actions.media.mockClear();
    await runVideoPipeline({ pipeline: { step: "media" } }, f.actions);
    expect(f.steps).toEqual(["render"]);
    expect(f.actions.storyboard).not.toHaveBeenCalled();
    expect(f.actions.media).not.toHaveBeenCalled();
  });

  it("rewinds an edited empty storyboard instead of trying to render zero scenes", async () => {
    const f = fixture();
    await runVideoPipeline({ pipeline: { step: "render" } }, f.actions);
    expect(f.steps).toEqual(["storyboard", "media", "render"]);
  });

  it("fails closed if media reports success but a scene is still missing audio", async () => {
    const f = fixture();
    f.actions.media.mockImplementation(async () => undefined);
    await expect(runVideoPipeline({}, f.actions)).rejects.toThrow("chưa có đủ media");
    expect(f.actions.render).not.toHaveBeenCalled();
  });

  it("requires actual duration and synchronized captions before declaring a scene ready", () => {
    const f = fixture();
    expect(sceneMediaReady(f.pending)).toBe(false);
    expect(pipelineCheckpoint({ pipeline: { step: "invalid" } }).step).toBe("storyboard");
  });
});
