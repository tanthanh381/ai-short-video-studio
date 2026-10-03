import { z } from "zod";

export type WordTimestamp = { word: string; start: number; end: number };

const storyboardResultSchema = z.object({
  hook: z.string().min(1).max(500),
  narration: z.string().min(1).max(30_000),
  scenes: z
    .array(
      z.object({
        narration: z.string().min(1).max(5_000),
        imagePrompt: z.string().min(1).max(2_000),
        estimatedDurationMs: z.number().int().min(2_000).max(15_000),
      }),
    )
    .min(2)
    .max(18),
  suggestedTitle: z.string().min(1).max(200),
  suggestedDescription: z.string().min(1).max(2_000),
});

export type StoryboardResult = z.infer<typeof storyboardResultSchema>;

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

export interface StoryboardProvider {
  createStoryboard(input: StoryboardInput): Promise<StoryboardResult>;
}

export interface MediaProvider {
  createImage(prompt: string, aspectRatio: string): Promise<Uint8Array>;
  createSpeech(text: string, voice: string): Promise<Uint8Array>;
  transcribe(audio: Uint8Array): Promise<WordTimestamp[]>;
}

export interface AIProvider extends StoryboardProvider, MediaProvider {}

export const storyboardJsonSchema = {
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
            minimum: 2_000,
            maximum: 15_000,
          },
        },
      },
    },
  },
} as const;

export function buildStoryboardInstruction(input: StoryboardInput) {
  const editingRule =
    input.inputMode === "full-script" && !input.rewrite
      ? "Giữ nguyên nội dung và câu chữ của kịch bản, chỉ chia cảnh."
      : "Có thể biên tập câu chữ để tăng nhịp kể.";
  return `Bạn là biên tập viên video ngắn tiếng Việt. Tạo storyboard ${input.duration} giây cho đối tượng: ${input.audience}. Phong cách: ${input.style}. ${editingRule} Mỗi cảnh 4-9 giây. Prompt ảnh không chứa chữ, logo hay thương hiệu; phong cách hình: ${input.visualStyle}. Tổng narration phải khớp nội dung các cảnh.`;
}

export function parseStoryboard(value: unknown): StoryboardResult {
  const parsed =
    typeof value === "string" ? JSON.parse(value) : (value as unknown);
  return storyboardResultSchema.parse(parsed);
}
