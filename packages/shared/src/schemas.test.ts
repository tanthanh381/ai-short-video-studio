import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  createVideoSchema,
  projectSettingsSchema,
  subtitleCueSchema,
} from "./schemas";
import { DEFAULT_PROJECT_SETTINGS } from "./index";

describe("schema du an", () => {
  it("one-click accepts only script and preserves original whitespace and diacritics", () => {
    const script = "  Một ngày mới.\nHãy sống chậm lại.  ";
    expect(createVideoSchema.parse({ sourceText: script }).sourceText).toBe(script);
    expect(createVideoSchema.parse({ sourceText: script }).settings).toEqual({});
    expect(() => createVideoSchema.parse({ sourceText: "          " })).toThrow();
  });
  it("chap nhan du an hop le", () => {
    const parsed = createProjectSchema.parse({
      title: "Một phút sống chậm",
      sourceText: "Có những ngày chúng ta cần dừng lại để nghe chính mình.",
      inputMode: "idea",
      settings: DEFAULT_PROJECT_SETTINGS,
    });
    expect(parsed.settings.aspectRatio).toBe("9:16");
  });

  it("tu choi timestamp nguoc", () => {
    expect(() =>
      subtitleCueSchema.parse({
        id: crypto.randomUUID(),
        startMs: 2000,
        endMs: 1000,
        text: "Không hợp lệ",
      }),
    ).toThrow();
  });

  it("giu che do 0 dong voi media upload thu cong", () => {
    const settings = projectSettingsSchema.parse({
      textProvider: "anthropic",
      targetDurationSec: 30,
      aspectRatio: "9:16",
      allowUploads: true,
      musicVolume: 0.12,
    });
    expect(settings.allowUploads).toBe(true);
    expect(settings.musicVolume).toBe(0.12);
  });

  it("chan du an khong co y tuong", () => {
    expect(() =>
      createProjectSchema.parse({
        title: "Video",
        sourceText: "ngan",
        settings: projectSettingsSchema.parse({}),
      }),
    ).toThrow();
  });
});
