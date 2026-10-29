import { describe, expect, it } from "vitest";
import { evaluatePublishReadiness } from "./publish-readiness";

const scene = { imagePath: "image.png", audioPath: "voice.wav", subtitles: [{ text: "ok" }] };

describe("publish readiness", () => {
  it("marks a completed, technically complete 9:16 project ready", () => {
    expect(evaluatePublishReadiness({ completed: true, hasResult: true, width: 1080, height: 1920, aspectRatio: "9:16", contentScore: 84, hookScore: 84, subtitlesEnabled: true, scenes: [scene] })).toEqual({ ready: true, blockers: [] });
  });
  it("does not call an exported but low-quality project ready", () => {
    const result = evaluatePublishReadiness({ completed: true, hasResult: true, width: 1080, height: 1920, aspectRatio: "9:16", contentScore: 62, hookScore: 82, subtitlesEnabled: true, scenes: [scene] });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Content check dưới 80/100");
  });
  it("blocks a technically complete video whose opening hook is below 8/10", () => {
    const result = evaluatePublishReadiness({ completed: true, hasResult: true, width: 1080, height: 1920, aspectRatio: "9:16", contentScore: 86, hookScore: 79, subtitlesEnabled: true, scenes: [scene] });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Hook 3 giây đầu dưới 8/10");
  });
  it("reports missing scene assets and wrong aspect ratio without blocking download itself", () => {
    const result = evaluatePublishReadiness({ completed: true, hasResult: true, width: 1920, height: 1080, aspectRatio: "9:16", contentScore: 90, hookScore: 90, subtitlesEnabled: true, scenes: [{ imagePath: null, audioPath: "voice.wav", subtitles: [] }] });
    expect(result.blockers).toEqual(expect.arrayContaining(["Thiếu ảnh hoặc giọng đọc", "Thiếu phụ đề ở một hoặc nhiều scene", "Tỷ lệ khung hình không khớp"]));
  });
});
