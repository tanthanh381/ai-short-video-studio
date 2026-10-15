import type { Project, Scene } from "@studio/shared";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The local value wherever the person changed it since `base`, otherwise whatever the server has now. */
const pick = <T>(base: T, local: T, latest: T): T => (same(base, local) ? latest : local);

const PROJECT_FIELDS = ["title", "sourceText", "inputMode", "hook", "suggestedTitle", "suggestedDescription"] as const;

function mergeScene(base: Scene | undefined, local: Scene, latest: Scene | undefined): Scene {
  if (!base || !latest) return local; // added here, or already gone on the server: the person's version stands
  const merged: Record<string, unknown> = { ...latest };
  for (const key of Object.keys(local) as Array<keyof Scene>) merged[key] = pick(base[key], local[key], latest[key]);
  return merged as unknown as Scene;
}

/**
 * Three-way merge of a person's unsaved edits (`local`, made on top of `base`) with what the server holds now (`latest`).
 * The server moves on by itself (a finished job updates the project and its media), so a save built on an old copy is
 * refused as stale; instead of asking the person to reload and lose the edit, the edit is carried onto the new copy:
 * a field the person changed keeps their value, every other field takes the server's.
 */
export function rebaseEdits(base: Project, local: Project, latest: Project): Project {
  const out: Project = { ...latest, updatedAt: latest.updatedAt };
  for (const key of PROJECT_FIELDS) (out as Record<string, unknown>)[key] = pick(base[key], local[key], latest[key]);
  out.status = pick(base.status, local.status, latest.status);
  const settings: Record<string, unknown> = { ...latest.settings };
  for (const key of new Set([...Object.keys(local.settings), ...Object.keys(base.settings)])) {
    const k = key as keyof Project["settings"];
    settings[key] = pick(base.settings[k], local.settings[k], latest.settings[k]);
  }
  out.settings = settings as unknown as Project["settings"];
  const baseById = new Map(base.scenes.map((scene) => [scene.id, scene]));
  const latestById = new Map(latest.scenes.map((scene) => [scene.id, scene]));
  const structureChanged = !same(base.scenes.map((scene) => scene.id), local.scenes.map((scene) => scene.id));
  if (structureChanged) {
    out.scenes = local.scenes.map((scene) => mergeScene(baseById.get(scene.id), scene, latestById.get(scene.id)));
  } else {
    const localById = new Map(local.scenes.map((scene) => [scene.id, scene]));
    out.scenes = latest.scenes.map((scene) => {
      const mine = localById.get(scene.id);
      return mine ? mergeScene(baseById.get(scene.id), mine, scene) : scene;
    });
  }
  return out;
}
