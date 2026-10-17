import type { ProjectSettings } from "@studio/shared";

/** Real representative frames used by the renderer's visual presets in the creation wizard. */
const VISUAL_PREVIEW_FILES: Record<string, string> = {
  "cinematic-color": "cinematic-reading.jpg",
  "ink-monochrome": "ink-wash-sepia.jpg",
  cartoon: "cartoon-folk.jpg",
  historical: "historical-scholar.jpg",
  watercolor: "watercolor-healing.jpg",
  "paper-cut": "paper-cut.jpg",
  "chibi-co-phong": "paper-stage.jpg",
  "chibi-tien-hiep": "fantasy-chibi.jpg",
  "chibi-dan-gian-viet": "vietnamese-folk.jpg",
  "chibi-co-trang-hai": "comedy-chibi.jpg",
  "thuy-mac-co-phong": "ink-wash-sepia.jpg",
  "thuy-mac-sepia": "ink-wash-sepia.jpg",
  "paper-storybook": "storybook-fox.jpg",
  "chibi-huyen-bi": "mystery-chibi.jpg",
  "chibi-dong-vat-co-phong": "fantasy-chibi.jpg",
  whiteboard: "whiteboard-learning.jpg",
};

/** Story cards have a frame-specific look that takes precedence over the visual style. */
export function previewImageForSettings(settings: Pick<ProjectSettings, "layoutTemplate" | "cardTheme" | "visualPreset">): string {
  if (settings.layoutTemplate === "paper-stage") return "paper-stage.jpg";
  if (settings.layoutTemplate === "story-card") {
    if (settings.cardTheme === "sepia") return "ink-wash-sepia.jpg";
    if (settings.cardTheme === "blurred") return "cinematic-reading.jpg";
    return "cartoon-folk.jpg";
  }
  return VISUAL_PREVIEW_FILES[settings.visualPreset] ?? "cinematic-reading.jpg";
}
