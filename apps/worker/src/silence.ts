/**
 * "Cắt khoảng lặng" on a 16-bit PCM WAV from the voice bridge, keeping its subtitle cues exact.
 *
 * The old path cut silence with ffmpeg and threw the cues away, so the subtitles had to come from Whisper, whose
 * Vietnamese never matches the script word for word: every scene of every video with this option failed
 * ("Whisper nhận chữ khác kịch bản"). Trimming the samples here and moving the cues by the same amount needs no
 * transcription at all.
 */

type Cue = { startMs: number; endMs: number };

type Wav = { sampleRate: number; channels: number; bitsPerSample: number; data: Uint8Array; headerEnd: number };

function readWav(wav: Uint8Array): Wav | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
  if (wav.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let format: Omit<Wav, "data" | "headerEnd"> | null = null;
  while (offset + 8 <= wav.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bitsPerSample: view.getUint16(body + 14, true) };
    } else if (id === "data" && format) {
      return { ...format, data: wav.subarray(body, Math.min(wav.byteLength, body + size)), headerEnd: body };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function writeWav(format: Pick<Wav, "sampleRate" | "channels" | "bitsPerSample">, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + data.byteLength);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => { out[offset + index] = char.charCodeAt(0); });
  const blockAlign = format.channels * format.bitsPerSample / 8;
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, data.byteLength, true);
  out.set(data, 44);
  return out;
}

/**
 * Cuts silence before the first and after the last sound (below `thresholdDb`, keeping `padMs` so no syllable is
 * clipped) and shifts every cue by the cut, clamped to the new length. Anything but 16-bit PCM is returned unchanged.
 */
export function trimWavSilence<C extends Cue>(wav: Uint8Array, cues: C[], options: { thresholdDb?: number; padMs?: number } = {}):
  { wav: Uint8Array; cues: C[]; durationMs: number; trimmedMs: number } {
  const parsed = readWav(wav);
  if (!parsed || parsed.bitsPerSample !== 16 || parsed.channels < 1) {
    const durationMs = parsed ? Math.round(parsed.data.byteLength / (parsed.channels * 2) / parsed.sampleRate * 1000) : 0;
    return { wav, cues, durationMs, trimmedMs: 0 };
  }
  const frameBytes = parsed.channels * 2;
  const frames = Math.floor(parsed.data.byteLength / frameBytes);
  const samples = new DataView(parsed.data.buffer, parsed.data.byteOffset, frames * frameBytes);
  const threshold = 32768 * 10 ** ((options.thresholdDb ?? -50) / 20);
  const loud = (frame: number) => {
    for (let channel = 0; channel < parsed.channels; channel++)
      if (Math.abs(samples.getInt16(frame * frameBytes + channel * 2, true)) > threshold) return true;
    return false;
  };
  let first = 0;
  while (first < frames && !loud(first)) first++;
  const msPerFrame = 1000 / parsed.sampleRate;
  if (first >= frames) return { wav, cues, durationMs: Math.round(frames * msPerFrame), trimmedMs: 0 };
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  const pad = Math.round((options.padMs ?? 60) / msPerFrame);
  const start = Math.max(0, first - pad);
  const end = Math.min(frames, last + 1 + pad);
  const startMs = Math.round(start * msPerFrame);
  const durationMs = Math.round((end - start) * msPerFrame);
  const data = parsed.data.subarray(start * frameBytes, end * frameBytes);
  let previousEnd = 0;
  const shifted = cues.map((cue, index) => {
    const from = Math.max(previousEnd, Math.min(durationMs - 1, cue.startMs - startMs));
    const to = index === cues.length - 1 ? durationMs : Math.max(from + 1, Math.min(durationMs, cue.endMs - startMs));
    previousEnd = to;
    return { ...cue, startMs: from, endMs: to };
  });
  return { wav: writeWav(parsed, data), cues: shifted, durationMs, trimmedMs: Math.round(frames * msPerFrame) - durationMs };
}
