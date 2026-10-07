import { randomUUID } from "node:crypto";
import type { Scene } from "@studio/shared";
import {
  buildStoryboardInstruction,
  lockedVisualStoryboardJsonSchema,
  parseLockedVisualStoryboard,
  parseStoryboard,
  storyboardJsonSchema,
  type AIProvider,
  type StoryboardInput,
  type StoryboardResult,
  type WordTimestamp,
} from "./providers";

async function checked(response: Response) {
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    throw new Error(
      `OpenAI API trả lỗi ${response.status}${requestId ? ` (mã yêu cầu ${requestId})` : ""}`,
    );
  }
  return response;
}

export class OpenAIAdapter implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly models = {
      text: "gpt-5-mini",
      image: "gpt-image-2.5-sunburst",
      tts: "gpt-4o-mini-tts",
    },
  ) {}
  private headers() {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async createStoryboard(input: StoryboardInput): Promise<StoryboardResult> {
    const response = await checked(
      await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model: this.models.text,
          instructions: buildStoryboardInstruction(input),
          input: input.lockedScenes
            ? JSON.stringify({
                title: input.title,
                storyContext: input.sourceText,
                sceneOffset: input.sceneOffset ?? 0,
                totalScenes: input.totalScenes ?? input.lockedScenes.length,
                lockedScenes: input.lockedScenes,
              })
            : `Tên video: ${input.title}\nNội dung:\n${input.sourceText}`,
          text: {
            format: {
              type: "json_schema",
              name: "storyboard",
              strict: true,
              schema: input.lockedScenes
                ? lockedVisualStoryboardJsonSchema(input.lockedScenes.length)
                : storyboardJsonSchema,
            },
          },
        }),
      }),
    );
    const data = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text =
      data.output_text ??
      data.output
        ?.flatMap((o) => o.content ?? [])
        .find((c) => c.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI không trả về storyboard");
    return input.lockedScenes
      ? parseLockedVisualStoryboard(input, text)
      : parseStoryboard(text);
  }

  async createImage(prompt: string, aspectRatio: string): Promise<Uint8Array> {
    const size =
      aspectRatio === "16:9"
        ? "1536x1024"
        : aspectRatio === "1:1"
          ? "1024x1024"
          : "1024x1536";
    const response = await checked(
      await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model: this.models.image,
          prompt,
          size,
          quality: "medium",
          output_format: "png",
        }),
      }),
    );
    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const base64 = data.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI không trả về ảnh");
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  async createSpeech(text: string, voice: string): Promise<Uint8Array> {
    const response = await checked(
      await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model: this.models.tts,
          voice,
          input: text,
          response_format: "mp3",
          instructions:
            "Đọc tiếng Việt tự nhiên, ấm áp, rõ dấu, nhịp kể chuyện vừa phải. Không đọc quá kịch.",
        }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async transcribe(audio: Uint8Array): Promise<WordTimestamp[]> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([audio as BlobPart], { type: "audio/mpeg" }),
      `${randomUUID()}.mp3`,
    );
    form.append("model", "whisper-1");
    form.append("language", "vi");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const response = await checked(
      await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: this.headers(),
        body: form,
      }),
    );
    const data = (await response.json()) as { words?: WordTimestamp[] };
    if (!data.words?.length)
      throw new Error("Không nhận được timestamp từ audio thật");
    return data.words;
  }
}

export function groupWords(words: WordTimestamp[]): Scene["subtitles"] {
  const cues: Scene["subtitles"] = [];
  let group: WordTimestamp[] = [];
  const flush = () => {
    if (!group.length) return;
    cues.push({
      id: randomUUID(),
      startMs: Math.round(group[0]!.start * 1000),
      endMs: Math.max(
        Math.round(group[group.length - 1]!.end * 1000),
        Math.round(group[0]!.start * 1000) + 250,
      ),
      text: group
        .map((w) => w.word.trim())
        .join(" ")
        .replace(/\s+([,.!?;:])/g, "$1"),
    });
    group = [];
  };
  for (const word of words) {
    group.push(word);
    const duration = group[group.length - 1]!.end - group[0]!.start;
    if (group.length >= 6 || duration >= 2.2 || /[.!?]$/.test(word.word))
      flush();
  }
  flush();
  return cues;
}
