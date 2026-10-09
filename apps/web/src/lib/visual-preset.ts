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

/** Quiet dark-olive captions under the character, no box: they read on kraft paper like printed text. */
const PAPER_SUBTITLE = {
  preset: "minimal" as const,
  fontColor: "#59563A",
  outlineColor: "#E8DCB8",
  backgroundColor: "#E8DCB8",
  backgroundOpacity: 0,
};

/**
 * Each frame comes with the look it is built for: the story card with flat cartoon pictures, the paper stage with the
 * chibi character and quiet captions. Leaving the paper stage gives the default captions back.
 */
export function withLayoutTemplate(settings: ProjectSettings, layoutTemplate: ProjectSettings["layoutTemplate"]): ProjectSettings {
  if (layoutTemplate === "story-card")
    return { ...withVisualPreset(leavePaper(settings), "cartoon"), layoutTemplate, aspectRatio: "9:16", autoMusic: true };
  if (layoutTemplate === "paper-stage")
    return { ...withVisualPreset(settings, "chibi-co-phong"), layoutTemplate, aspectRatio: "9:16", autoMusic: true,
      captionHighlight: false, hookTitle: false, subtitle: { ...settings.subtitle, ...PAPER_SUBTITLE } };
  return { ...leavePaper(settings), layoutTemplate };
}

function leavePaper(settings: ProjectSettings): ProjectSettings {
  if (settings.layoutTemplate !== "paper-stage") return settings;
  const { preset, fontColor, outlineColor, backgroundColor, backgroundOpacity } = DEFAULT_PROJECT_SETTINGS.subtitle;
  return { ...settings, subtitle: { ...settings.subtitle, preset, fontColor, outlineColor, backgroundColor, backgroundOpacity } };
}
