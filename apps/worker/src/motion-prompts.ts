import type { VisualPreset } from "@studio/shared";

/**
 * LTX receives one cue per scene so motion does not collapse into the same generic
 * camera move. The cues describe small, safe changes that preserve the generated
 * character instead of asking the model to invent a new action.
 */
const MOTION_CUES = [
  "the character blinks once and breathes gently, with a tiny rise and fall of the shoulders",
  "hair strands and long sleeves sway softly as if touched by a light breeze",
  "a small cloud or veil of smoke drifts slowly behind the character while the face stays stable",
  "a few flower petals or paper flecks fall through the foreground at different depths",
  "the character makes a tiny natural hand or head movement, then settles back into the pose",
] as const;

const STYLE_MOTION: Partial<Record<VisualPreset, string>> = {
  "chibi-tien-hiep": "floating talismans and mountain mist drift slowly",
  "chibi-dan-gian-viet": "lotus petals, bamboo leaves or a rice-paper fleck moves gently",
  "chibi-co-trang-hai": "the sleeve bounces slightly with the comic reaction, then settles",
  "thuy-mac-co-phong": "ink-wash mist blooms and fades slowly like wet brush on paper",
  "paper-storybook": "the foreground paper layer shifts a few millimetres with a soft stop-motion feel",
  "chibi-huyen-bi": "lantern flame flickers while smoke and one firefly drift in the background",
  "chibi-dong-vat-co-phong": "ears or tail make one small expressive movement while the character remains recognisable",
};

export function sceneMotionPrompt(preset: VisualPreset, sceneIndex: number): string {
  const cue = STYLE_MOTION[preset] ?? MOTION_CUES[sceneIndex % MOTION_CUES.length];
  return [
    "Create a short image-to-video shot from this exact reference image.",
    cue + ".",
    "Add a very slow 9:16 camera push-in or gentle side drift.",
    "Preserve the same face, costume, pose, proportions, text-free artwork and background layout.",
    "No morphing, no new limbs, no lip-sync, no scene change, no flicker, no fast movement.",
  ].join(" ");
}
