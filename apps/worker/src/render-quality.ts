import type { Scene } from "@studio/shared";

/** Technical checks only: this is not a semantic or retention score. */
export function validateCaptionTiming(scene: Scene, audioDurationMs: number) {
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0)
    throw new Error(`Scene ${scene.order + 1}: invalid measured audio duration`);
  if (!scene.subtitles.length)
    throw new Error(`Scene ${scene.order + 1}: subtitles are enabled but missing; repair this scene's subtitles`);
  let previousEnd = 0;
  for (const cue of scene.subtitles) {
    if (!cue.text.trim() || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)
      || cue.startMs < previousEnd || cue.startMs < 0 || cue.endMs <= cue.startMs
      || cue.endMs > audioDurationMs + 80) {
      throw new Error(`Scene ${scene.order + 1}: invalid subtitle timing; repair this scene's subtitles`);
    }
    previousEnd = cue.endMs;
  }
}

/** Preserve voice gain; lower the music while speech is present. */
export function buildAudioMixFilter(hasMusic: boolean, volume: number, durationMs: number, musicInputIndex = 1) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new Error("Music volume must be between 0 and 1");
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("Audio duration must be positive");
  // Disable automatic makeup gain and compensate look-ahead latency.
  const limiter = "alimiter=limit=0.95:level=false:latency=true";
  if (!hasMusic) return `[0:a]${limiter}[a]`;
  const format = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  const fadeStart = Math.max(0, durationMs / 1000 - 1).toFixed(3);
  return `[0:a]${format},asplit=2[voice][sidechain];`
    + `[${musicInputIndex}:a]${format},volume=${volume},afade=t=out:st=${fadeStart}:d=1[music];`
    + "[music][sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=250:makeup=1[ducked];"
    + `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,${limiter}[a]`;
}
