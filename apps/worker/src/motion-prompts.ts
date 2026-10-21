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
  // The ancient-wisdom paper stage uses the chibi-co-phong image preset. Keep the motion grounded in
  // ordinary gestures from the reference shorts instead of defaulting to atmospheric fantasy motion.
  "chibi-co-phong": "keep the flat 2D hand-drawn chibi look, the kraft-paper texture and the olive ink palette unchanged and animate only gentle idle motion: the same little boy makes one small everyday gesture matching the pose (a small nod, lifting a tea cup, tilting a held prop, turning a page or sweeping once) then settles, with a slow breathing shoulder bob, a soft sway of the robe hem and the hair-ribbon tails, one natural blink and a light drift of any held prop, loop-friendly and calm with no large, fast or jerky movement",
  "chibi-tien-hiep": "floating talismans and mountain mist drift slowly",
  "chibi-dan-gian-viet": "lotus petals, bamboo leaves or a rice-paper fleck moves gently",
  "chibi-co-trang-hai": "the sleeve bounces slightly with the comic reaction, then settles",
  "thuy-mac-co-phong": "ink-wash mist blooms and fades slowly like wet brush on paper",
  "paper-storybook": "the foreground paper layer shifts a few millimetres with a soft stop-motion feel",
  "chibi-huyen-bi": "lantern flame flickers while smoke and one firefly drift in the background",
  "chibi-dong-vat-co-phong": "ears or tail make one small expressive movement while the character remains recognisable",
};

/** Keep generated motion tied to what the narrator actually says instead of inventing a generic gesture. */
function narrativeMotion(narration: string): string | null {
  const text = narration.toLocaleLowerCase("vi-VN");
  if (/(mở|đóng|cửa|cổng|khóa|chìa)/u.test(text))
    return "show one clear, slow interaction with the mentioned door, gate or key; the hand stays attached and the object stays in place";
  if (/(bước|đi bộ|đi qua|chạy|quay về|rời khỏi|tiến lại)/u.test(text))
    return "show the referenced person taking one small natural step or turning into the scene while the camera follows gently";
  if (/(cầm|nâng|đặt|chạm|đưa|viết|đọc|sách|điện thoại|đèn|ngọn lửa)/u.test(text))
    return "show the mentioned object receiving one deliberate, slow movement from the existing hand; keep the hand count and object shape stable";
  if (/(hỏi|nói|kể|mỉm cười|nhìn|nghe|gật|suy nghĩ)/u.test(text))
    return "show one readable facial or gaze change matching the line, such as a gentle glance or small nod, without changing identity";
  if (/(mưa|gió|khói|sương|lá|hoa|ánh sáng|sáng lên|tối)/u.test(text))
    return "animate the mentioned atmosphere or light as the primary visible motion while the subject remains grounded and recognisable";
  return null;
}

export function sceneMotionPrompt(preset: VisualPreset, sceneIndex: number, narration = ""): string {
  // Keep the legacy micro-motion cycle when narration is unavailable (it is covered by the generic
  // prompt tests), but use the more grounded everyday cue for real paper-stage scenes.
  const cue = preset === "chibi-co-phong" && narration.trim()
    ? STYLE_MOTION[preset]!
    : preset === "chibi-co-phong"
      ? MOTION_CUES[sceneIndex % MOTION_CUES.length]
      : STYLE_MOTION[preset] ?? MOTION_CUES[sceneIndex % MOTION_CUES.length];
  const storyCue = narrativeMotion(narration) ?? "make one visible but restrained action over the shot, then settle naturally";
  return [
    "Create a short image-to-video shot from this exact reference image.",
    storyCue + ".",
    cue + ".",
    "Add a visible but slow 9:16 camera push-in or gentle side drift with foreground/background parallax.",
    "Preserve the same face, costume, pose, proportions, text-free artwork and background layout.",
    "No morphing, no new limbs, no extra fingers, no lip-sync, no scene change, no flicker, no fast movement.",
  ].join(" ");
}
