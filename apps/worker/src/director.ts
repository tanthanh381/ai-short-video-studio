import type { ProductionPlan } from "@studio/shared";

// Director-Agent Phase 2b: pure helpers (no I/O) so they can be unit-tested. The orchestration that calls Claude and
// persists the plan lives in index.ts (it needs the db/config/log); everything deterministic lives here.

/** Estimate a scene's spoken length (ms) from its narration — mirrors the storyboard writer's own fallback. */
export function estimateSceneMs(narration: string): number {
  const words = narration.trim().split(/\s+/u).filter(Boolean).length;
  return Math.min(15_000, Math.max(2_000, Math.round((words / 2.5) * 1_000)));
}

/** Convert a Director plan into the StoryboardResult shape the rest of writeStoryboard already knows how to save. */
export function directorStoryboardResult(plan: ProductionPlan): {
  scenes: Array<{ narration: string; imagePrompt: string; estimatedDurationMs: number }>;
  narration: string;
  suggestedTitle: string;
} {
  const scenes = plan.scenes.map((scene) => ({
    narration: scene.narration,
    imagePrompt: scene.imagePrompt,
    estimatedDurationMs: estimateSceneMs(scene.narration),
  }));
  return {
    scenes,
    narration: scenes.map((scene) => scene.narration).join("\n"),
    suggestedTitle: (plan.hook.text || scenes[0]!.narration).slice(0, 200),
  };
}

/**
 * Decide whether one scene gets real MLX motion.
 * - Director mode (motionScenes provided): animate exactly the scenes the plan chose.
 * - Pipeline mode: the hybrid rule — paper-stage chibi animates the opening scene only; other presets animate every
 *   scene a motion model is set for.
 * Always false when no motion model is available.
 */
export function sceneWantsMotion(opts: {
  hasMotionModel: boolean;
  motionScenes: number[] | null;
  paperStage: boolean;
  sceneOrder: number;
}): boolean {
  if (!opts.hasMotionModel) return false;
  if (opts.motionScenes) return opts.motionScenes.includes(opts.sceneOrder);
  return !opts.paperStage || opts.sceneOrder === 0;
}
