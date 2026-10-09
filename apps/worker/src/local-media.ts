import { z } from "zod";
import { subtitleCueSchema } from "@studio/shared";
import type { MediaModelOptions, MediaProvider, WordTimestamp } from "./providers";

async function checked(response: Response) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Media local trả lỗi ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return response;
}

export class LocalMediaAdapter implements MediaProvider {
  constructor(private readonly baseUrl: string) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async createImage(prompt: string, aspectRatio: string, models: MediaModelOptions = {}): Promise<Uint8Array> {
    const response = await checked(
      await fetch(this.url("/image"), {
        method: "POST",
        signal: AbortSignal.timeout(900_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          model: models.image ?? undefined,
          seed: models.seed ?? undefined,
          style: models.style,
          preset: models.preset,
          referenceImage: models.referenceImageBase64 ?? undefined,
        }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async createVideo(input: { image: Uint8Array; prompt: string; aspectRatio: string }, models: MediaModelOptions = {}): Promise<Uint8Array> {
    if (!models.video) throw new Error("Chưa chọn model video local");
    const response = await checked(
      await fetch(this.url("/video"), {
        method: "POST",
        signal: AbortSignal.timeout(1_800_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: models.video,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          seed: models.seed ?? undefined,
          preset: models.preset,
          imageBase64: Buffer.from(input.image).toString("base64"),
        }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async createSpeech(text: string, voice: string, models: MediaModelOptions = {}): Promise<Uint8Array> {
    const response = await checked(
      await fetch(this.url("/tts"), {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice, engine: models.tts ?? undefined, speed: models.speed ?? undefined }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async createSpeechAligned(text: string, voice: string, models: MediaModelOptions = {}) {
    const response = await checked(await fetch(this.url("/tts-aligned"), {
      method: "POST",
      signal: AbortSignal.timeout(240_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice, engine: models.tts ?? undefined, speed: models.speed ?? undefined }),
    }));
    const parsed = z.object({
      audioBase64: z.string().min(10),
      cues: z.array(subtitleCueSchema).min(1),
      durationMs: z.number().int().positive(),
    }).safeParse(await response.json());
    if (!parsed.success) throw new Error("Dịch vụ giọng đọc local trả dữ liệu không hợp lệ; hãy thử lại");
    const data = parsed.data;
    if (data.cues.map((cue) => cue.text).join("") !== text)
      throw new Error("Giọng đọc local không bảo toàn kịch bản; chưa lưu kết quả");
    if (data.cues.some((cue, index) => cue.endMs > data.durationMs || (index > 0 && cue.startMs < data.cues[index - 1]!.endMs)))
      throw new Error("Timestamp audio local không hợp lệ");
    return { audio: new Uint8Array(Buffer.from(data.audioBase64, "base64")), cues: data.cues, durationMs: data.durationMs, contentType: "audio/wav" as const };
  }

  async transcribe(audio: Uint8Array, models: MediaModelOptions = {}): Promise<WordTimestamp[]> {
    const response = await checked(
      await fetch(this.url(`/transcribe${models.transcribe ? `?model=${encodeURIComponent(models.transcribe)}` : ""}`), {
        method: "POST",
        signal: AbortSignal.timeout(900_000),
        headers: { "content-type": "audio/mpeg" },
        body: Buffer.from(audio),
      }),
    );
    const data = (await response.json()) as { words?: WordTimestamp[] };
    if (!data.words?.length) throw new Error("Whisper local không trả timestamp");
    return data.words;
  }
}
