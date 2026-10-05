import { describe, expect, it } from "vitest";
import { regenerationRequestSchema } from "./regeneration";
const sceneId = "c84187c5-33ad-4c80-a6f3-b925ca4aee31";
describe("regeneration request", () => {
  it("keeps legacy clients compatible", () => expect(regenerationRequestSchema.parse({sceneId}).component).toBe("all"));
  it.each(["all", "image", "audio", "subtitles"])("accepts %s", component => expect(regenerationRequestSchema.parse({sceneId,component}).component).toBe(component));
  it.each(["video", "", null, 123, {}])("rejects invalid selection %j", component => expect(() => regenerationRequestSchema.parse({sceneId,component})).toThrow());
  it("rejects invalid scene ID", () => expect(() => regenerationRequestSchema.parse({sceneId:"other"})).toThrow());
  it("strips client supplied checkpoints and cleanup paths", () => expect(regenerationRequestSchema.parse({sceneId,component:"image",regeneration:{imagePath:"another-scene.png",subtitlesCompleted:true}})).toEqual({sceneId,component:"image"}));
});
