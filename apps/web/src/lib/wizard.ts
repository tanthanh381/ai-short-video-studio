/**
 * Pure logic for the video-creation wizard: the step list, input-type detection, and the AI-models step (which models
 * exist, their real health, and what "Auto" picks). Kept here, free of React, so it can be unit-tested. The wizard's
 * single state is the project's own `ProjectSettings` plus `sourceText`/`inputMode`; nothing here keeps a second copy of
 * a choice that already lives in settings.
 */
import {
  type LocalModelCatalog,
  type Project,
  type ProjectSettings,
  drawsByHand,
  looksLikeFinishedScript,
  looksLikeSubtitles,
} from "@studio/shared";
import type { ServiceId, ServiceState } from "./api";

export type WizardStepId = "input" | "template" | "models" | "audio" | "brand" | "review";

export const WIZARD_STEPS: Array<{ id: WizardStepId; label: string; short: string }> = [
  { id: "input", label: "Nội dung", short: "Nội dung" },
  { id: "template", label: "Mẫu video", short: "Mẫu" },
  { id: "models", label: "AI Models", short: "Models" },
  { id: "audio", label: "Giọng & Nhạc", short: "Âm thanh" },
  { id: "brand", label: "Logo & Bố cục", short: "Bố cục" },
  { id: "review", label: "Xem lại & tạo", short: "Xem lại" },
];

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((step) => step.id === id);
}

/**
 * Which kind of input the text is. A pasted subtitle block is always read as a written script; a finished-looking
 * script auto-switches to "full-script" until the person picks a mode themselves (then their choice is kept).
 */
export function detectInputMode(
  text: string,
  current: Project["inputMode"],
  userChose: boolean,
): { mode: Project["inputMode"]; auto: boolean } {
  if (looksLikeSubtitles(text)) return { mode: "full-script", auto: true };
  if (!userChose && current === "idea" && looksLikeFinishedScript(text)) return { mode: "full-script", auto: true };
  return { mode: current, auto: false };
}

// --- AI models step ---------------------------------------------------------

export type ModelHealth = "ready" | "configured" | "offline" | "disabled" | "unknown";
export type ModelGroupKey = "script" | "image" | "video" | "voice" | "subtitle";

export type ModelOption = {
  value: string;
  label: string;
  health: ModelHealth;
  /** A healthy or configured service can be selected; offline/disabled is shown but flagged. */
  selectable: boolean;
};
export type ModelGroup = {
  key: ModelGroupKey;
  label: string;
  /** The value currently chosen in settings. */
  current: string;
  options: ModelOption[];
  /** The health of the currently chosen option, for the group's status chip. */
  health: ModelHealth;
};

const HEALTH_FROM_SERVICE: Record<ServiceState, ModelHealth> = {
  healthy: "ready",
  configured: "configured",
  offline: "offline",
  disabled: "disabled",
  unknown: "unknown",
};

export const HEALTH_LABEL: Record<ModelHealth, string> = {
  ready: "Sẵn sàng",
  configured: "Đã cấu hình",
  offline: "Mất kết nối",
  disabled: "Đang tắt",
  unknown: "Chưa kiểm tra",
};

export const HEALTH_TONE: Record<ModelHealth, "ok" | "warn" | "bad" | "idle"> = {
  ready: "ok",
  configured: "idle",
  offline: "bad",
  disabled: "idle",
  unknown: "idle",
};

type Statuses = Partial<Record<ServiceId, ServiceState>>;

function health(statuses: Statuses, id: ServiceId): ModelHealth {
  const state = statuses[id];
  return state ? HEALTH_FROM_SERVICE[state] : "unknown";
}

const selectable = (h: ModelHealth) => h === "ready" || h === "configured";

/**
 * The five model groups with their real health, read from the account's service statuses and the local-model catalog.
 * `statuses` comes from `AccountSettings.serviceStatuses`; null means it has not loaded yet (everything "unknown").
 */
export function modelGroups(settings: ProjectSettings, statuses: Statuses | null, catalog: LocalModelCatalog | null): ModelGroup[] {
  const s = statuses ?? {};
  const localModel = (key: "video" | "tts" | "transcribe", fallbackLabel: string): { value: string; label: string } => {
    const entry = catalog?.[key];
    const chosen = settings.localModels[key];
    const model = entry?.models.find((m) => m.id === chosen) ?? entry?.models.find((m) => m.id === entry.default);
    return { value: chosen ?? "", label: model?.label ?? fallbackLabel };
  };

  const scriptOptions: ModelOption[] = [
    { value: "ollama", label: "Ollama (máy)", health: health(s, "ollama"), selectable: selectable(health(s, "ollama")) },
    { value: "anthropic", label: "Claude (API)", health: health(s, "anthropic"), selectable: selectable(health(s, "anthropic")) },
    { value: "openai", label: "OpenAI (API)", health: health(s, "openai"), selectable: selectable(health(s, "openai")) },
  ];
  const imageOptions: ModelOption[] = [
    { value: "local", label: "SDXL (máy)", health: health(s, "localMedia"), selectable: selectable(health(s, "localMedia")) },
    { value: "openai", label: "OpenAI Image (API)", health: health(s, "openai"), selectable: selectable(health(s, "openai")) },
  ];
  const scriptCurrent = scriptOptions.find((o) => o.value === settings.textProvider)!;
  const imageCurrent = imageOptions.find((o) => o.value === settings.mediaProvider)!;
  const localHealth = health(s, "localMedia");

  // Video motion and subtitle alignment run on the local media bridge; their engines come from the catalog.
  const video = localModel("video", "Ảnh tĩnh (không chuyển động)");
  const transcribe = localModel("transcribe", "Whisper");

  const groups: ModelGroup[] = [
    { key: "script", label: "Kịch bản / Storyboard", current: settings.textProvider, options: scriptOptions, health: scriptCurrent.health },
    { key: "image", label: "Hình ảnh", current: settings.mediaProvider, options: imageOptions, health: imageCurrent.health },
    {
      key: "video",
      label: "Chuyển động video",
      current: settings.localModels.video ?? "",
      options: [
        { value: "", label: catalog?.video.models.length ? "Tự chọn (LTX nếu sẵn sàng)" : "Ảnh tĩnh", health: localHealth, selectable: true },
        ...(catalog?.video.models ?? []).map((m) => ({ value: m.id, label: m.label, health: localHealth, selectable: selectable(localHealth) })),
      ],
      health: settings.mediaProvider === "openai" ? "disabled" : localHealth,
    },
    {
      key: "voice",
      label: "Giọng đọc",
      current: settings.mediaProvider === "openai" ? "openai" : settings.localModels.tts ?? "",
      options: settings.mediaProvider === "openai"
        ? [{ value: "openai", label: "OpenAI TTS (API)", health: health(s, "openai"), selectable: selectable(health(s, "openai")) }]
        : [
            { value: "", label: catalog?.tts.models.find((m) => m.id === catalog.tts.default)?.label ?? "VieNeu-TTS (máy)", health: localHealth, selectable: true },
            ...(catalog?.tts.models ?? []).map((m) => ({ value: m.id, label: m.label, health: localHealth, selectable: selectable(localHealth) })),
          ],
      health: settings.mediaProvider === "openai" ? health(s, "openai") : localHealth,
    },
    {
      key: "subtitle",
      label: "Khớp phụ đề",
      current: settings.localModels.transcribe ?? "",
      options: [
        { value: "", label: transcribe.label, health: localHealth, selectable: true },
        ...(catalog?.transcribe.models ?? []).map((m) => ({ value: m.id, label: m.label, health: localHealth, selectable: selectable(localHealth) })),
      ],
      health: settings.subtitle.enabled ? localHealth : "disabled",
    },
  ];
  return drawsByHand(settings) ? groups.filter((group) => group.key !== "video") : groups;
}

/** A short one-line summary of the chosen models, e.g. "Ollama · SDXL · LTX-Video · VieNeu-TTS · Whisper". */
export function modelSummary(settings: ProjectSettings, catalog: LocalModelCatalog | null): string {
  const name = (key: "video" | "tts" | "transcribe", fallback: string) => {
    const entry = catalog?.[key];
    const id = settings.localModels[key] ?? entry?.default;
    return entry?.models.find((m) => m.id === id)?.label ?? fallback;
  };
  const script = settings.textProvider === "ollama" ? "Ollama" : settings.textProvider === "anthropic" ? "Claude" : "OpenAI";
  if (settings.mediaProvider === "openai") return `${script} · OpenAI Image · OpenAI TTS`;
  if (drawsByHand(settings))
    return [script, "SDXL", "Vẽ tay bảng trắng", name("tts", "VieNeu-TTS"), settings.subtitle.enabled ? name("transcribe", "Whisper") : "Không phụ đề"].join(" · ");
  return [script, "SDXL", name("video", "Ảnh tĩnh"), name("tts", "VieNeu-TTS"), settings.subtitle.enabled ? name("transcribe", "Whisper") : "Không phụ đề"].join(" · ");
}

/**
 * "Auto": prefer the local pipeline (free, on-device) when its services are ready; otherwise fall back to a ready paid
 * provider so the project can still run. Returns only the fields it changes.
 */
export function autoModelPatch(statuses: Statuses | null): Partial<ProjectSettings> {
  const s = statuses ?? {};
  const ready = (id: ServiceId) => s[id] === "healthy";
  // Script first: prefer a saved cloud key (Claude writes trend-aware, stronger copy than the small local model);
  // fall back to free local Ollama only when no cloud key is saved. Media still goes local-first below, so turning
  // on a Claude key upgrades the writing without making images/voice paid.
  const textProvider: ProjectSettings["textProvider"] = ready("anthropic") ? "anthropic" : ready("openai") ? "openai" : ready("ollama") ? "ollama" : "ollama";
  const mediaProvider: ProjectSettings["mediaProvider"] = ready("localMedia") ? "local" : ready("openai") ? "openai" : "local";
  // Clear per-model overrides so the bridge's own defaults (best available) are used — but DO NOT touch `video`:
  // that field is the motion on/off CHOICE (a model id = motion on, null = still), not a "best model" pick, and a
  // template (e.g. Chibi cổ trang) turns it on deliberately. The caller merges this onto the existing localModels,
  // so leaving `video` out preserves the template's motion setting instead of silently disabling it.
  return { textProvider, mediaProvider, localModels: { storyboard: null, image: null, tts: null, transcribe: null } };
}

/** Whether every model the project will use is at least configured (so "Tạo video" will not fail at a dead service). */
export function modelsReady(settings: ProjectSettings, statuses: Statuses | null): boolean {
  return modelGroups(settings, statuses, null)
    .filter((group) => group.health !== "disabled")
    .every((group) => group.health === "ready" || group.health === "configured");
}
