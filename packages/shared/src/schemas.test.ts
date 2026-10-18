import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  createVideoSchema,
  projectSettingsSchema,
  sceneSchema,
  subtitleCueSchema,
  updateSceneSchema,
  whiteboardAnnotationSchema,
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

  it("settings cũ không có localModels vẫn hợp lệ và mặc định là null", () => {
    const parsed = projectSettingsSchema.parse({});
    expect(parsed.localModels).toEqual({ storyboard: null, image: null, video: null, tts: null, transcribe: null });
    expect(projectSettingsSchema.safeParse({ localModels: { image: "a b" } }).success).toBe(false);
  });

  it("giới hạn annotation whiteboard và từ chối payload không hợp lệ", () => {
    const annotation = whiteboardAnnotationSchema.parse({
      sceneId: "scene-1",
      canvas: { width: 1080, height: 1920 },
      sceneDurationMs: 4_000,
      elements: [{
        id: "title",
        label: "Tiêu đề",
        sequence: 0,
        narrativeRole: "title",
        type: "text",
        subtitle: "",
        region: { x: 20, y: 30, width: 500, height: 100 },
        reveal: { direction: "left_to_right", startMs: 0, durationMs: 500, maskPaddingPx: 8 },
        handPath: null,
      }],
    });
    expect(annotation.elements[0]?.reveal.protectedRegions).toEqual([]);
    expect(() => whiteboardAnnotationSchema.parse({ ...annotation, canvas: { width: 100_001, height: 1920 } })).toThrow();
    expect(() => whiteboardAnnotationSchema.parse({ ...annotation, elements: [{ ...annotation.elements[0], extra: true }] })).toThrow();
  });
});

describe("sceneSchema Vietnamese description", () => {
  const base = {
    id: "00000000-0000-4000-8000-000000000001",
    order: 0,
    narration: "Xin chào",
    imagePrompt: "A person waving, morning light",
    estimatedDurationMs: 3000,
  };

  it("defaults description to empty for scenes saved before the field existed", () => {
    const scene = sceneSchema.parse(base);
    expect(scene.description).toBe("");
  });

  it("round-trips a Vietnamese description and rejects one over 2000 chars", () => {
    expect(sceneSchema.parse({ ...base, description: "Người vẫy tay trong nắng sớm" }).description)
      .toBe("Người vẫy tay trong nắng sớm");
    expect(() => sceneSchema.parse({ ...base, description: "a".repeat(2001) })).toThrow();
  });

  it("lets a scene update carry the description", () => {
    expect(updateSceneSchema.parse({ description: "Mô tả mới" }).description).toBe("Mô tả mới");
  });
});
