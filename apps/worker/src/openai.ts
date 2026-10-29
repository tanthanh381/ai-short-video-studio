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

/** Says what the provider's status means for the owner, in Vietnamese: a refused key and an empty balance are fixed in different places. */
export function providerErrorMessage(name: string, consoleHost: string, status: number, requestId?: string | null): string {
  const id = requestId ? ` (mã yêu cầu ${requestId})` : "";
  if (status === 401) return `${name} từ chối khóa API của bạn (sai hoặc đã bị thu hồi). Hãy tạo khóa mới tại ${consoleHost} và dán lại ở Cài đặt.${id}`;
  if (status === 403) return `Khóa API ${name} của bạn không có quyền dùng chức năng này (khóa bị giới hạn quyền hoặc tài khoản chưa được cấp). Kiểm tra tại ${consoleHost}.${id}`;
  if (status === 402 || status === 429) return `${name} từ chối vì hết số dư hoặc vượt giới hạn tốc độ của tài khoản bạn. Kiểm tra gói và số dư tại ${consoleHost}, rồi thử lại sau.${id}`;
  if (status >= 500) return `${name} đang gặp sự cố (lỗi ${status}). Hãy thử lại sau ít phút.${id}`;
  return `${name} API trả lỗi ${status}${id}`;
}

async function checked(response: Response) {
  if (!response.ok) throw new Error(providerErrorMessage("OpenAI", "platform.openai.com", response.status, response.headers.get("x-request-id")));
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
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}
  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }
  private headers() {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async createStoryboard(input: StoryboardInput): Promise<StoryboardResult> {
    const response = await checked(
      await fetch(this.url("/responses"), {
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
      await fetch(this.url("/images/generations"), {
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

  async createSpeech(text: string, voice: string, models: { voiceDirection?: string } = {}): Promise<Uint8Array> {
    const response = await checked(
      await fetch(this.url("/audio/speech"), {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          model: this.models.tts,
          voice,
          input: text,
          response_format: "mp3",
          instructions:
            `Đọc tiếng Việt tự nhiên, ấm áp, rõ dấu, nhịp kể chuyện vừa phải. Không đọc quá kịch. ${models.voiceDirection ?? ""}`,
        }),
      }),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async writePostCaption(input: { sourceText: string; title: string }): Promise<{ title: string; description: string; hashtags: string[] } | null> {
    try {
      const response = await checked(
        await fetch(this.url("/responses"), {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: { ...this.headers(), "content-type": "application/json" },
          body: JSON.stringify({
            model: this.models.text,
            instructions:
              "Bạn viết nội dung đăng kèm cho một video ngắn tiếng Việt (TikTok, Reels, Shorts). Chỉ dựa trên nội dung được cung cấp, không bịa thêm. " +
              "title: tiêu đề tiếng Việt cuốn hút, đúng nội dung, tối đa 70 ký tự, không giật tít sai sự thật. " +
              "description: 1-2 câu mô tả tự nhiên khơi gợi người xem, có thể thêm tối đa một emoji. " +
              "hashtags: 3-5 hashtag tiếng Việt không dấu, viết liền, bắt đầu bằng #, bám sát chủ đề. Trả về đúng JSON.",
            input: `Tiêu đề gợi ý: ${input.title}\nNội dung video:\n${input.sourceText.slice(0, 6_000)}`,
            text: {
              format: {
                type: "json_schema",
                name: "post_caption",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "description", "hashtags"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    hashtags: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          }),
        }),
      );
      const data = (await response.json()) as { output_text?: string };
      if (!data.output_text) return null;
      const parsed = JSON.parse(data.output_text) as { title?: unknown; description?: unknown; hashtags?: unknown };
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
      if (!title && !description) return null;
      return {
        title,
        description,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((tag): tag is string => typeof tag === "string") : [],
      };
    } catch {
      return null;
    }
  }

  async writeKeyPoints(input: { narrations: string[]; title: string }): Promise<string[] | null> {
    if (!input.narrations.length) return null;
    try {
      const response = await checked(
        await fetch(this.url("/responses"), {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: { ...this.headers(), "content-type": "application/json" },
          body: JSON.stringify({
            model: this.models.text,
            instructions:
              "Video giải thích tiếng Việt: với mỗi cảnh, viết MỘT ý chính thật ngắn để hiện chữ to trên màn hình. " +
              "Mỗi ý chính 2-5 từ tiếng Việt, cô đọng, bám đúng nội dung cảnh đó, không phải câu đầy đủ, không dấu câu cuối. " +
              "Trả về JSON { keyPoints: [...] } với số phần tử ĐÚNG BẰNG số cảnh, theo đúng thứ tự.",
            input: `Tiêu đề: ${input.title}\nCác cảnh:\n${input.narrations.map((text, index) => `${index + 1}. ${text}`).join("\n").slice(0, 8_000)}`,
            text: {
              format: {
                type: "json_schema",
                name: "key_points",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["keyPoints"],
                  properties: { keyPoints: { type: "array", items: { type: "string" } } },
                },
              },
            },
          }),
        }),
      );
      const data = (await response.json()) as { output_text?: string };
      if (!data.output_text) return null;
      const parsed = JSON.parse(data.output_text) as { keyPoints?: unknown };
      const list: unknown[] = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
      if (!list.length) return null;
      return input.narrations.map((_, index) => {
        const value = list[index];
        return typeof value === "string" ? value.trim().slice(0, 80) : "";
      });
    } catch {
      return null;
    }
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
      await fetch(this.url("/audio/transcriptions"), {
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
