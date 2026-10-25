import { DEFAULT_PROJECT_SETTINGS, type LocalModelCatalog } from "@studio/shared";
import type { ServiceId, ServiceState } from "./api";
import { describe, expect, it } from "vitest";
import { autoModelPatch, detectInputMode, modelGroups, modelSummary, modelsReady, WIZARD_STEPS } from "./wizard";

const base = { ...DEFAULT_PROJECT_SETTINGS, textProvider: "ollama" as const, mediaProvider: "local" as const };
const statuses = (over: Partial<Record<ServiceId, ServiceState>> = {}): Partial<Record<ServiceId, ServiceState>> => ({
  ollama: "healthy", localMedia: "healthy", openai: "disabled", anthropic: "disabled", ...over,
});
const catalog: LocalModelCatalog = {
  available: true,
  storyboard: { models: [{ id: "llama", label: "Llama" }], default: "llama" },
  image: { models: [{ id: "sdxl", label: "SDXL Base" }], default: "sdxl" },
  video: { models: [{ id: "ltx", label: "LTX-Video" }], default: "ltx" },
  tts: { models: [{ id: "vieneu", label: "VieNeu-TTS" }], default: "vieneu" },
  transcribe: { models: [{ id: "phowhisper", label: "PhoWhisper" }], default: "phowhisper" },
};

describe("wizard steps", () => {
  it("has six steps in order", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["input", "template", "models", "audio", "brand", "review"]);
  });
});

describe("detectInputMode", () => {
  it("reads a pasted subtitle block as a written script", () => {
    expect(detectInputMode("1\n00:00:01,000 --> 00:00:03,000\nXin chào", "idea", false)).toEqual({ mode: "full-script", auto: true });
  });
  it("keeps the mode the person chose themselves", () => {
    const long = "Câu một. ".repeat(40);
    expect(detectInputMode(long, "idea", true)).toEqual({ mode: "idea", auto: false });
  });
});

describe("modelGroups health", () => {
  it("reads each group's real service state", () => {
    const groups = modelGroups(base, statuses(), catalog);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey.script!.health).toBe("ready");
    expect(byKey.image!.health).toBe("ready");
    expect(byKey.script!.options.find((o) => o.value === "openai")!.health).toBe("disabled");
    expect(byKey.script!.options.find((o) => o.value === "openai")!.selectable).toBe(false);
    expect(byKey.voice!.options.some((o) => o.label === "VieNeu-TTS")).toBe(true);
  });
  it("marks the local pipeline offline when the media bridge is down", () => {
    const groups = modelGroups(base, statuses({ localMedia: "offline" }), catalog);
    expect(groups.find((g) => g.key === "image")!.health).toBe("offline");
    expect(groups.find((g) => g.key === "voice")!.health).toBe("offline");
  });
  it("shows the OpenAI voice when the media provider is OpenAI", () => {
    const groups = modelGroups({ ...base, mediaProvider: "openai" }, statuses({ openai: "healthy" }), catalog);
    const voice = groups.find((g) => g.key === "voice")!;
    expect(voice.current).toBe("openai");
    expect(voice.health).toBe("ready");
  });
  it("does not show LTX controls in whiteboard mode", () => {
    const whiteboard = { ...base, visualPreset: "whiteboard" as const };
    expect(modelGroups(whiteboard, statuses(), catalog).some((group) => group.key === "video")).toBe(false);
    expect(modelSummary(whiteboard, catalog)).toContain("Vẽ tay bảng trắng");
    expect(modelSummary(whiteboard, catalog)).not.toContain("LTX");
  });
});

describe("modelSummary", () => {
  it("lists the chosen local models", () => {
    expect(modelSummary(base, catalog)).toBe("Ollama · SDXL · LTX-Video · VieNeu-TTS · PhoWhisper");
  });
  it("lists the OpenAI pipeline", () => {
    expect(modelSummary({ ...base, textProvider: "openai", mediaProvider: "openai" }, catalog)).toBe("OpenAI · OpenAI Image · OpenAI TTS");
  });
});

describe("autoModelPatch", () => {
  it("uses free local text when no cloud key is saved", () => {
    expect(autoModelPatch(statuses())).toMatchObject({ textProvider: "ollama", mediaProvider: "local" });
  });
  it("prefers a saved Claude key for the script, keeping media local", () => {
    expect(autoModelPatch(statuses({ anthropic: "healthy" })))
      .toMatchObject({ textProvider: "anthropic", mediaProvider: "local" });
  });
  it("falls back to a ready paid provider when local is down", () => {
    expect(autoModelPatch({ ollama: "offline", localMedia: "offline", openai: "healthy", anthropic: "healthy" }))
      .toMatchObject({ textProvider: "anthropic", mediaProvider: "openai" });
  });
  it("clears per-model overrides so bridge defaults win, but never touches video (motion choice)", () => {
    const localModels = autoModelPatch(statuses()).localModels;
    expect(localModels).toEqual({ storyboard: null, image: null, tts: null, transcribe: null });
    expect(localModels).not.toHaveProperty("video"); // preserved on merge → template motion stays on
  });
});

describe("modelsReady", () => {
  it("is true when the chosen services are ready", () => {
    expect(modelsReady(base, statuses())).toBe(true);
  });
  it("is false when a chosen service is offline", () => {
    expect(modelsReady(base, statuses({ localMedia: "offline" }))).toBe(false);
  });
});
