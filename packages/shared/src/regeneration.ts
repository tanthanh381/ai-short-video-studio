import { z } from "zod";
export const regenerationComponentSchema = z.enum(["all", "image", "audio", "subtitles"]).default("all");
export type RegenerationComponent = z.infer<typeof regenerationComponentSchema>;
/** Strip client-supplied worker checkpoints and cleanup paths. */
export const regenerationRequestSchema = z.object({ sceneId: z.string().uuid(), component: regenerationComponentSchema });
