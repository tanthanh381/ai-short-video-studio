import type { Project } from "@studio/shared";

/**
 * The script a project's scenes spell out. "Lời đọc gốc" is that script: editing a scene, adding, deleting or moving one
 * keeps it in step, so the studio never holds two versions of the narration (one in the box, one in the scenes).
 * Fewer than 10 characters (every scene deleted) keeps the previous script, as the API requires at least that many.
 */
export function withScriptFromScenes(project: Project): Project {
  const script = project.scenes.map((scene) => scene.narration.trim()).filter(Boolean).join("\n");
  if (script.length < 10 || script === project.sourceText) return project;
  return { ...project, sourceText: script, inputMode: "full-script" };
}
