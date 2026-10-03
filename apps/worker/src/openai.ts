import { randomUUID } from "node:crypto";
import type { Scene } from "@studio/shared";

type Word = { word: string; start: number; end: number };
export type StoryboardResult = {
  hook: string;
  narration: string;
  scenes: Array<{
    narration: string;
    imagePrompt: string;
    estimatedDurationMs: number;
  }>;
  suggestedTitle: string;
  suggestedDescription: string;
};

export type StoryboardInput = {
  title: string;
  sourceText: string;
  inputMode: string;
  rewrite: boolean;
  audience: string;
  style: string;
  duration: number;
  visualStyle: string;
};

export interface AIProvider {
  createStoryboard(input: StoryboardInput): Promise<StoryboardResult>;
  createImage(prompt: string, aspectRatio: string): Promise<Uint8Array>;
  createSpeech(text: string, voice: string): Promise<Uint8Array>;
  transcribe(audio: Uint8Array): Promise<Word[]>;
}

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
    const instruction = `Bạn là biên tập viên video ngắn tiếng Việt. Tạo storyboard ${input.duration} giây cho đối tượng: ${input.audience}. Phong cách: ${input.style}. ${input.inputMode === "full-script" && !input.rewrite ? "Giữ nguyên nội dung và câu chữ của kịch bản, chỉ chia cảnh." : "Có thể biên tập câu chữ để tăng nhịp kể."} Mỗi cảnh 4-9 giây. Prompt ảnh không chứa chữ, logo hay thương hiệu; phong cách hình: ${input.visualStyle}.`;
    const schema = {
      type: "object",
      additionalProperties: false,
      required: [
        "hook",
        "narration",
        "scenes",
        "suggestedTitle",
        "suggestedDescription",
      ],
      properties: {
        hook: { type: "string" },
        narration: { type: "string" },
        suggestedTitle: { type: "string" },
        suggestedDescription: { type: "string" },
        scenes: {
          type: "array",
          minItems: 2,
          maxItems: 18,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["narration", "imagePrompt", "estimatedDurationMs"],
            properties: {
              narration: { type: "string" },
              imagePrompt: { type: "string" },
              estimatedDurationMs: {
                type: "integer",
                minimum: 2000,
                maximum: 15000,
              },
            },
          },
        },
      },
    };
    const response = await checked(
      await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model: this.models.text,
          instructions: instruction,
          input: `Tên video: ${input.title}\nNội dung:\n${input.sourceText}`,
          text: {
            format: {
              type: "json_schema",
              name: "storyboard",
              strict: true,
              schema,
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
    return JSON.parse(text) as StoryboardResult;
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

  async transcribe(audio: Uint8Array): Promise<Word[]> {
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
    const data = (await response.json()) as { words?: Word[] };
    if (!data.words?.length)
      throw new Error("Không nhận được timestamp từ audio thật");
    return data.words;
  }
}

export function groupWords(words: Word[]): Scene["subtitles"] {
  const cues: Scene["subtitles"] = [];
  let group: Word[] = [];
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
