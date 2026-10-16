/** Logo helpers for the studio: where the preview draws it (the export's own rule) and a look at an uploaded file. */
import { logoAnchor, type ProjectSettings } from "@studio/shared";

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** The video frame the export renders for each shape (apps/worker/src/render.ts videoSize). */
export function frameSize(ratio: ProjectSettings["aspectRatio"]) {
  return ratio === "16:9" ? { width: 1920, height: 1080 } : ratio === "1:1" ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
}

/** The logo's place on the preview, in % of the frame, from the same rule the MP4 uses. */
export function logoPreviewStyle(settings: ProjectSettings): Record<string, string> {
  const frame = frameSize(settings.aspectRatio);
  const anchor = logoAnchor(settings, frame);
  const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;
  const style: Record<string, string> = { width: pct(anchor.width, frame.width), opacity: String(settings.logoOpacity) };
  if (anchor.x.from === "center") { style.left = "50%"; style.transform = "translateX(-50%)"; }
  else style[anchor.x.from] = pct(anchor.x.px, frame.width);
  style[anchor.y.from] = pct(anchor.y.px, frame.height);
  return style;
}

/**
 * Whether an uploaded logo looks like a round logo saved on a plain square (no transparency, square, light corners):
 * such a file shows as a white box on the video unless it is cut to a circle.
 */
export function looksLikeRoundLogoOnSquare(pixels: { width: number; height: number; at(x: number, y: number): [number, number, number, number] }): boolean {
  const { width, height } = pixels;
  if (!width || !height || Math.abs(width - height) / Math.max(width, height) > 0.03) return false;
  const inset = Math.max(1, Math.round(width * 0.01));
  const corners = [pixels.at(inset, inset), pixels.at(width - 1 - inset, inset), pixels.at(inset, height - 1 - inset), pixels.at(width - 1 - inset, height - 1 - inset)];
  const opaque = corners.every(([, , , a]) => a > 250);
  const light = corners.every(([r, g, b]) => Math.min(r, g, b) > 200);
  const same = corners.every(([r, g, b]) => Math.abs(r - corners[0]![0]) + Math.abs(g - corners[0]![1]) + Math.abs(b - corners[0]![2]) < 40);
  return opaque && light && same;
}

/** Reads an image file and runs looksLikeRoundLogoOnSquare on it; false when the browser cannot read it. */
export async function checkLogoFile(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return looksLikeRoundLogoOnSquare({
      width: bitmap.width,
      height: bitmap.height,
      at: (x, y) => {
        const i = (y * bitmap.width + x) * 4;
        return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      },
    });
  } catch {
    return false;
  }
}
