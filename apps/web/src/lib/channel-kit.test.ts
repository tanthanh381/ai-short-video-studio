import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "@studio/shared";
import { applyChannelKit, saveChannelKit } from "./channel-kit";

describe("channel kit", () => {
  it("keeps channel identity while excluding project content", () => {
    const settings = { ...DEFAULT_PROJECT_SETTINGS, brandName: "Kênh thử", voice: "tam-su" as const, logoPath: "user/logo.png" };
    const kit = saveChannelKit(settings);
    expect(kit.brandName).toBe("Kênh thử");
    expect(kit.voice).toBe("tam-su");
    expect("sourceText" in kit).toBe(false);
  });

  it("applies the saved channel styling without replacing project content", () => {
    const kit = saveChannelKit({ ...DEFAULT_PROJECT_SETTINGS, brandName: "Studio", voiceSpeed: 0.92 });
    const next = applyChannelKit({ ...DEFAULT_PROJECT_SETTINGS, brandName: "Video riêng" }, kit);
    expect(next.brandName).toBe("Studio");
    expect(next.voiceSpeed).toBe(0.92);
    expect(next.subtitle.fontColor).toBe(DEFAULT_PROJECT_SETTINGS.subtitle.fontColor);
  });
});

