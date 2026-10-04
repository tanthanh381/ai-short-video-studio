import type { MediaProvider, WordTimestamp } from "./providers";

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

  async createImage(prompt: string, aspectRatio: string): Promise<Uint8Array> {
    const response = await checked(
      await fetch(this.url("/image"), {
        method: "POST",
        signal: AbortSignal.timeout(900_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async createSpeech(text: string, voice: string): Promise<Uint8Array> {
    const response = await checked(
      await fetch(this.url("/tts"), {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async transcribe(audio: Uint8Array): Promise<WordTimestamp[]> {
    const response = await checked(
      await fetch(this.url("/transcribe"), {
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
