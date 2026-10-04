import type { Project } from "@studio/shared";

export type PipelineStep = "storyboard" | "media" | "render" | "complete";
export type PipelineCheckpoint = { version: 1; step: PipelineStep };

export function pipelineCheckpoint(payload: Record<string, unknown>): PipelineCheckpoint {
  const stored = payload.pipeline as { step?: string } | undefined;
  const step = stored?.step;
  return { version: 1, step: step === "media" || step === "render" || step === "complete" ? step : "storyboard" };
}

export function sceneMediaReady(scene: Project["scenes"][number], subtitlesEnabled = true) {
  return scene.mediaStatus === "ready" && Boolean(scene.imagePath && scene.audioPath && scene.actualDurationMs)
    && (!subtitlesEnabled || scene.subtitles.length > 0);
}

export async function runVideoPipeline(
  payload: Record<string, unknown>,
  actions: {
    getProject(): Promise<Project>;
    storyboard(project: Project): Promise<void>;
    media(project: Project): Promise<void>;
    render(project: Project): Promise<void>;
    checkpoint(value: PipelineCheckpoint): Promise<void>;
    progress(value: number, stage: string): Promise<void>;
  },
) {
  let checkpoint = pipelineCheckpoint(payload);
  let project = await actions.getProject();
  // A manual script edit may clear scenes after a terminal failure.
  if (!project.scenes.length) checkpoint = { version: 1, step: "storyboard" };
  if (checkpoint.step === "storyboard") {
    await actions.progress(2, "Đang chia kịch bản thành cảnh");
    // Recover a crash after scenes were saved, before the checkpoint was saved.
    if (!project.scenes.length) await actions.storyboard(project);
    checkpoint = { version: 1, step: "media" };
    await actions.checkpoint(checkpoint);
    project = await actions.getProject();
  }
  if (checkpoint.step === "media" || checkpoint.step === "render") {
    if (!project.scenes.length) throw new Error("Chưa tạo được cảnh từ kịch bản");
    if (project.scenes.some((scene) => !sceneMediaReady(scene, project.settings.subtitle.enabled))) {
      await actions.progress(20, "Đang tạo ảnh, giọng đọc và phụ đề");
      await actions.media(project);
      project = await actions.getProject();
    }
    if (project.scenes.some((scene) => !sceneMediaReady(scene, project.settings.subtitle.enabled)))
      throw new Error("Một số cảnh chưa có đủ media; các cảnh thành công đã được giữ lại");
    checkpoint = { version: 1, step: "render" };
    await actions.checkpoint(checkpoint);
    await actions.progress(76, "Đang ghép video hoàn chỉnh");
    await actions.render(project);
    checkpoint = { version: 1, step: "complete" };
    await actions.checkpoint(checkpoint);
  }
}
