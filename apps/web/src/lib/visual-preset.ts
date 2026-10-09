import { DEFAULT_PROJECT_SETTINGS, VISUAL_PRESET_OPTIONS, type ProjectSettings } from "@studio/shared";

/** The ink look pairs with dark-on-cream subtitles; leaving it must undo those colours, not keep them. */
const INK_SUBTITLE = {
  preset: "minimal" as const,
  fontColor: "#171717",
  outlineColor: "#F5F1E8",
  backgroundColor: "#F5F1E8",
  backgroundOpacity: 0.94,
};

export function withVisualPreset(settings: ProjectSettings, visualPreset: ProjectSettings["visualPreset"]): ProjectSettings {
  const option = VISUAL_PRESET_OPTIONS.find((item) => item.id === visualPreset) ?? VISUAL_PRESET_OPTIONS[0]!;
  const next = { ...settings, visualPreset, visualStyle: option.description };
  if (visualPreset === "ink-monochrome") return { ...next, subtitle: { ...settings.subtitle, ...INK_SUBTITLE } };
  if (settings.visualPreset === "ink-monochrome") {
    const { preset, fontColor, outlineColor, backgroundColor, backgroundOpacity } = DEFAULT_PROJECT_SETTINGS.subtitle;
    return { ...next, subtitle: { ...settings.subtitle, preset, fontColor, outlineColor, backgroundColor, backgroundOpacity } };
  }
  return next;
}

/** The story card is a flat illustrated look: switch to it together with the matching picture style and music. */
export function withLayoutTemplate(settings: ProjectSettings, layoutTemplate: ProjectSettings["layoutTemplate"]): ProjectSettings {
  if (layoutTemplate !== "story-card") return { ...settings, layoutTemplate };
  return { ...withVisualPreset(settings, "cartoon"), layoutTemplate, aspectRatio: "9:16", autoMusic: true, voiceSpeed: Math.max(settings.voiceSpeed, 1.15) };
}
