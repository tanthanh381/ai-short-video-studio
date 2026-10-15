/**
 * Video length from an idea: how many words the narration needs for the chosen duration and voice, and how the
 * script is laid out at that length. One source for the create form's preview and the worker's script writer.
 */

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180] as const;
export type DurationSec = (typeof DURATION_OPTIONS)[number];

/**
 * Spoken words per second of a finished video, worked out like the voice bridge does it (local-tools/media_server.py: PACE_TARGET_WPS,
 * PACE_VIDEO_FACTOR, PACE_TEMPO_RANGE, VOICE_PRESETS; a test keeps the two in step). A voice is brought to PACE_WPS × mood words a
 * second of finished video, but only within TEMPO_RANGE of its own pace: a stronger time stretch is audible, so a naturally slow
 * voice (Đức Trí, 2.9 words a second) reads at about 3 rather than being forced to 3.7.
 */
export const PACE_WPS = 3.7;
/** Share of a finished narration that is speech; the rest is the pauses between phrases. */
export const SPEECH_SHARE = 0.84;
export const TEMPO_RANGE = { min: 0.85, max: 1.18 } as const;

/** Mood of each voice, as in media_server.py VOICE_PRESETS (a test keeps the two in sync). */
export const VOICE_MOOD: Record<string, number> = {
  "doc-truyen": 0.8,
  "co-trang": 0.8,
  "co-trang-nu": 0.86,
  "triet-ly": 0.84,
  "tam-su": 0.78,
  "tin-tuc": 1.05,
  "tin-tuc-nu": 1.05,
  "thuyet-minh": 1.02,
  "nang-dong": 1.05,
};

/** Words a second each voice speaks on its own, without pauses or any stretch (media_server.py VOICE_PRESETS, third value). */
export const VOICE_NATIVE_WPS: Record<string, number> = {
  "doc-truyen": 2.87,
  "co-trang": 2.89,
  "co-trang-nu": 3.58,
  "triet-ly": 3.69,
  "tam-su": 2.78,
  "tin-tuc": 3.34,
  "tin-tuc-nu": 4.16,
  "thuyet-minh": 4.1,
  "nang-dong": 4.3,
};

/** How far a script may miss its word budget before it is rewritten or trimmed (±10% ≈ ±6 s on a minute). */
export const LENGTH_TOLERANCE = 0.1;

export function spokenWordsPerSecond(voice: string, voiceSpeed = 1): number {
  const speed = Math.min(2, Math.max(0.5, voiceSpeed || 1));
  const mood = VOICE_MOOD[voice] ?? 1;
  const native = VOICE_NATIVE_WPS[voice];
  if (!native) return PACE_WPS * mood * speed; // a voice that was never measured
  const tempo = Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, (PACE_WPS * mood) / SPEECH_SHARE / native));
  return native * tempo * speed * SPEECH_SHARE;
}

export function narrationSeconds(words: number, voice: string, voiceSpeed = 1): number {
  return words / spokenWordsPerSecond(voice, voiceSpeed);
}

export function wordBudget(durationSec: number, voice: string, voiceSpeed = 1): { target: number; min: number; max: number } {
  const target = Math.round(durationSec * spokenWordsPerSecond(voice, voiceSpeed));
  return {
    target,
    min: Math.floor(target * (1 - LENGTH_TOLERANCE)),
    max: Math.ceil(target * (1 + LENGTH_TOLERANCE)),
  };
}

export type ContentBeat = { label: string; brief: string; words: number };
export type ContentPlan = {
  durationSec: number;
  words: { target: number; min: number; max: number };
  beats: ContentBeat[];
  /** About how many scenes the storyboard will cut (one picture per ~14.5 spoken words in finished videos). */
  scenes: number;
  /** One line for the create form, e.g. "Mở đầu gây tò mò → 2 ý chính → Kết". */
  summary: string;
};

/** Main points (tips, reflections) or story events that fit each length. */
function pointsFor(durationSec: number): number {
  if (durationSec <= 15) return 1;
  if (durationSec <= 30) return 2;
  if (durationSec <= 60) return 3;
  if (durationSec <= 90) return 4;
  if (durationSec <= 120) return 5;
  return 7;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function contentPlan(durationSec: number, style: string, voice: string, voiceSpeed = 1): ContentPlan {
  const words = wordBudget(durationSec, voice, voiceSpeed);
  // Keep the spoken hook short enough to land in the first ~3 seconds of a short-form video.
  // The lower bound still gives the model enough room for a real question or concrete promise.
  const hookWords = clamp(Math.round(words.target * 0.12), 7, 12);
  const endWords = clamp(Math.round(words.target * 0.13), 7, 28);
  const points = pointsFor(durationSec);
  const middle: Array<Omit<ContentBeat, "words">> = [];
  let hook: Omit<ContentBeat, "words">;
  let end: Omit<ContentBeat, "words">;
  let summary: string;
  if (style === "ke-chuyen") {
    // A story needs a turn even at 15 s; longer videos add setup, then more events before the turn.
    hook = { label: "Mở đầu", brief: "một câu gây tò mò về điều sắp xảy ra" };
    if (durationSec > 15) middle.push({ label: "Bối cảnh", brief: "nhân vật là ai, ở đâu, đang muốn gì" });
    for (let index = 1; index <= Math.max(0, points - 2); index++)
      middle.push({ label: `Diễn biến ${index}`, brief: "một việc cụ thể xảy ra, đẩy câu chuyện đi tiếp" });
    middle.push({ label: "Bước ngoặt", brief: "điều bất ngờ hoặc lựa chọn quyết định" });
    end = { label: "Kết", brief: "kết cục và bài học đọng lại trong một câu" };
    const events = middle.filter((beat) => beat.label.startsWith("Diễn biến")).length;
    summary = ["Mở đầu", durationSec > 15 ? "Bối cảnh" : null, events ? `${events} diễn biến` : null, "Bước ngoặt", "Kết"]
      .filter(Boolean).join(" → ");
  } else if (style === "truyen-cam-hung") {
    hook = { label: "Mở đầu", brief: "một câu chạm đúng cảm xúc người xem" };
    for (let index = 1; index <= points; index++)
      middle.push({ label: `Suy ngẫm ${index}`, brief: "một hình ảnh đời thường và điều nó nói lên" });
    end = { label: "Kết", brief: "một câu đọng lại để người xem mang theo" };
    summary = `Mở đầu chạm cảm xúc → ${points} suy ngẫm → Kết đọng lại`;
  } else {
    // kien-thuc, meo-cuoc-song and anything else: a hook, numbered points with an example, a takeaway.
    hook = { label: "Mở đầu", brief: "một câu hỏi hoặc điều bất ngờ có thật khiến người xem ở lại" };
    for (let index = 1; index <= points; index++)
      middle.push({ label: `Ý ${index}`, brief: "một ý cụ thể kèm ví dụ đời thường" });
    end = { label: "Kết", brief: "tóm lại và một việc người xem làm được ngay" };
    summary = `Mở đầu gây tò mò → ${points} ý chính → Kết`;
  }
  const bodyWords = Math.max(middle.length * 6, words.target - hookWords - endWords);
  const each = Math.floor(bodyWords / middle.length);
  const beats: ContentBeat[] = [
    { ...hook, words: hookWords },
    ...middle.map((beat, index) => ({ ...beat, words: each + (index < bodyWords - each * middle.length ? 1 : 0) })),
    { ...end, words: endWords },
  ];
  return { durationSec, words, beats, scenes: Math.max(2, Math.round(words.target / 14.5)), summary };
}

/**
 * Reading-speed factor that brings voiced narration to its target, or null when it is close enough (±8%).
 * The word budget alone misses: the same voice read 3.8-4.1 words/s across scripts (questions and exclamations run
 * faster), and a "1 phút" idea came out at 50 s. Clamped to ±12% so the voice still sounds natural.
 */
export function paceCorrection(actualMs: number, targetSec: number): number | null {
  if (!actualMs || !targetSec) return null;
  const ratio = actualMs / 1000 / targetSec;
  if (Math.abs(1 - ratio) <= 0.08) return null;
  return Math.min(1.12, Math.max(0.88, ratio));
}

/** "45 giây", "1 phút", "1 phút 30 giây". */
export function durationLabel(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} giây`;
  return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`;
}
