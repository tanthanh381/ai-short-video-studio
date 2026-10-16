/**
 * The logo on the studio preview. Read-only it sits where the MP4 will draw it; in layout mode it can be dragged to any
 * spot (logoPosition "custom") and resized from its corner handle, with the mouse, a finger or the arrow keys. The
 * values it reports are the same shares of the frame the export uses (packages/shared/src/logo.ts).
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PLATFORM_SAFE, STORY_BAND, type ProjectSettings } from "@studio/shared";
import { logoPreviewStyle } from "../lib/logo";

type Patch = Pick<ProjectSettings, "logoPosition" | "logoX" | "logoY" | "logoScale">;

const MIN_SCALE = 0.05;
const MAX_SCALE = 0.35;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number) => Math.round(value * 1000) / 1000;

export function StageLogo({ src, settings, editing, onChange }: {
  src: string;
  settings: ProjectSettings;
  editing: boolean;
  /** Called once a drag, resize or key press ends, with the new placement. */
  onChange(patch: Patch): void;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  // While a pointer is down the logo follows it from this local copy; the project is changed once, on release.
  const [live, setLive] = useState<Patch | null>(null);
  const gesture = useRef<{ kind: "move" | "resize"; startX: number; startY: number; left: number; top: number; width: number; height: number; stageW: number; stageH: number } | null>(null);
  const shown = live ? { ...settings, ...live } : settings;
  const circle = settings.logoShape === "circle";

  /** Where the logo is now, as shares of the stage (also when it still sits on a preset corner). */
  function measure() {
    const box = element.current!.getBoundingClientRect();
    const stage = element.current!.parentElement!.getBoundingClientRect();
    return { left: (box.left - stage.left) / stage.width, top: (box.top - stage.top) / stage.height, width: box.width, height: box.height, stageW: stage.width, stageH: stage.height };
  }

  function start(kind: "move" | "resize", event: PointerEvent<HTMLElement>) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, startX: event.clientX, startY: event.clientY, ...measure() };
  }

  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = (event.clientX - g.startX) / g.stageW;
    const dy = (event.clientY - g.startY) / g.stageH;
    if (g.kind === "move") {
      setLive({
        logoPosition: "custom",
        logoScale: settings.logoScale,
        logoX: round(clamp(g.left + dx, 0, 1 - g.width / g.stageW)),
        logoY: round(clamp(g.top + dy, 0, 1 - g.height / g.stageH)),
      });
    } else {
      // grows from its top-left corner, never past the frame's right or bottom edge
      const aspect = g.height / g.width;
      const fits = Math.min((1 - g.left) * g.stageW, ((1 - g.top) * g.stageH) / aspect) / g.stageW;
      const scale = clamp(settings.logoScale * (g.width + event.clientX - g.startX) / g.width, MIN_SCALE, Math.min(MAX_SCALE, fits));
      setLive({ logoPosition: "custom", logoScale: round(scale), logoX: round(g.left), logoY: round(g.top) });
    }
  }

  function end() {
    if (!gesture.current) return;
    gesture.current = null;
    if (live) onChange(live);
    setLive(null);
  }

  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    if (!editing) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const keys: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], "+": [0, 0, 0.01], "=": [0, 0, 0.01], "-": [0, 0, -0.01],
    };
    const delta = keys[event.key];
    if (!delta) return;
    event.preventDefault();
    const now = measure();
    const scale = round(clamp(settings.logoScale + delta[2], MIN_SCALE, MAX_SCALE));
    onChange({
      logoPosition: "custom",
      logoScale: scale,
      logoX: round(clamp(now.left + delta[0], 0, 1 - now.width / now.stageW)),
      logoY: round(clamp(now.top + delta[1], 0, 1 - now.height / now.stageH)),
    });
  }

  const percent = Math.round(shown.logoScale * 100);
  return (
    <div
      ref={element}
      className={`stage-logo ${circle ? "is-circle" : ""} ${editing ? "is-editing" : ""}`}
      style={logoPreviewStyle(shown)}
      {...(editing ? {
        role: "group",
        tabIndex: 0,
        "aria-label": `Logo, rộng ${percent}% khung. Kéo để di chuyển, kéo góc dưới phải để đổi cỡ; hoặc dùng phím mũi tên (giữ Shift để đi nhanh), phím + và - để đổi cỡ.`,
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => start("move", event),
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: end,
        onKeyDown: nudge,
      } : { "aria-hidden": true })}
    >
      <img src={src} alt="" draggable={false} />
      {editing && (
        <span
          className="stage-logo-resize"
          aria-hidden="true"
          onPointerDown={(event) => start("resize", event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
      {editing && live && <span className="stage-logo-size">{percent}%</span>}
    </div>
  );
}

/**
 * Layout-mode guides on the preview: the bands where TikTok, Reels and Shorts draw their own buttons (portrait only),
 * and on a story card the picture band, where the title and captions are not.
 */
export function StageGuides({ settings }: { settings: ProjectSettings }) {
  const portrait = settings.aspectRatio === "9:16";
  const storyCard = settings.layoutTemplate === "story-card" && portrait;
  const pct = (px: number) => `${((px / 1920) * 100).toFixed(2)}%`;
  return (
    <div className="stage-guides" aria-hidden="true">
      {portrait && <span className="stage-guide-unsafe" style={{ top: 0, height: pct(PLATFORM_SAFE.top) }}>Vùng ứng dụng che</span>}
      {portrait && <span className="stage-guide-unsafe" style={{ bottom: 0, height: pct(PLATFORM_SAFE.bottom) }}>Vùng ứng dụng che</span>}
      {storyCard && <span className="stage-guide-band" style={{ top: pct(STORY_BAND.top), height: pct(STORY_BAND.bottom - STORY_BAND.top) }}>Khung tranh</span>}
    </div>
  );
}
