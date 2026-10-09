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
/** Platform-style loudness target (short-form feeds normalise around −14 LUFS). */
const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000";

export function buildAudioMixFilter(hasMusic: boolean, volume: number, durationMs: number, musicInputIndex = 1, normalize = false) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new Error("Music volume must be between 0 and 1");
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("Audio duration must be positive");
  // Disable automatic makeup gain and compensate look-ahead latency.
  const limiter = "alimiter=limit=0.95:level=false:latency=true";
  const tail = normalize ? `${LOUDNESS},${limiter}` : limiter;
  if (!hasMusic) return `[0:a]${tail}[a]`;
  const format = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  const fadeStart = Math.max(0, durationMs / 1000 - 1).toFixed(3);
  return `[0:a]${format},asplit=2[voice][sidechain];`
    + `[${musicInputIndex}:a]${format},volume=${volume},afade=t=out:st=${fadeStart}:d=1[music];`
    + "[music][sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=250:makeup=1[ducked];"
    + `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,${tail}[a]`;
}

// A slow Am–F–C–G pad (4 chords × 8 s, cross-faded). Royalty-free by construction: it is synthesised, not sampled.
const AMBIENT_CHORDS: number[][] = [
  [110, 130.81, 164.81, 220],
  [87.31, 110, 130.81, 174.61],
  [130.81, 164.81, 196, 261.63],
  [98, 123.47, 146.83, 196],
];

/** ffmpeg arguments that write a 32-second seamless-ish ambient pad to `outPath` (loop it with -stream_loop). */
export function buildAmbientMusicArgs(outPath: string): string[] {
  const inputs: string[] = [];
  const chains: string[] = [];
  let index = 0;
  AMBIENT_CHORDS.forEach((chord, chordIndex) => {
    const labels = chord.map((frequency) => {
      inputs.push("-f", "lavfi", "-i", `sine=f=${frequency}:r=48000:d=9`);
      return `[${index++}:a]`;
    });
    chains.push(
      `${labels.join("")}amix=inputs=${chord.length}:normalize=0,volume=1.6,afade=t=in:st=0:d=2.5,afade=t=out:st=6.5:d=2.5,adelay=${chordIndex * 8000}:all=1[c${chordIndex}]`,
    );
  });
  const filter = `${chains.join(";")};[c0][c1][c2][c3]amix=inputs=4:normalize=0,lowpass=f=1500,tremolo=f=0.17:d=0.3,`
    + "aecho=0.8:0.55:700|1300:0.3|0.2,aformat=sample_fmts=fltp:channel_layouts=stereo[out]";
  return ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-t", "32", "-c:a", "pcm_s16le", outPath];
}
