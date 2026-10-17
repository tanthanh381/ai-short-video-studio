import type { ProjectSettings } from "@studio/shared";

const STORAGE_KEY = "studio:channel-kit:v1";

/** Settings that describe a channel identity, not a single video's content. */
export type ChannelKit = Pick<ProjectSettings,
  | "brandName" | "logoPath" | "logoShape" | "logoPosition" | "logoX" | "logoY" | "logoScale" | "logoOpacity"
  | "layoutTemplate" | "aspectRatio" | "cardTheme" | "cardTitle" | "visualPreset" | "visualStyle"
  | "voice" | "voiceSpeed" | "autoMusic" | "backgroundMusicPath" | "musicVolume"
  | "subtitle" | "captionHighlight" | "hookTitle" | "progressBar" | "sceneSfx"
>;

function fromSettings(settings: ProjectSettings): ChannelKit {
  return {
    brandName: settings.brandName,
    logoPath: settings.logoPath,
    logoShape: settings.logoShape,
    logoPosition: settings.logoPosition,
    logoX: settings.logoX,
    logoY: settings.logoY,
    logoScale: settings.logoScale,
    logoOpacity: settings.logoOpacity,
    layoutTemplate: settings.layoutTemplate,
    aspectRatio: settings.aspectRatio,
    cardTheme: settings.cardTheme,
    cardTitle: settings.cardTitle,
    visualPreset: settings.visualPreset,
    visualStyle: settings.visualStyle,
    voice: settings.voice,
    voiceSpeed: settings.voiceSpeed,
    autoMusic: settings.autoMusic,
    backgroundMusicPath: settings.backgroundMusicPath,
    musicVolume: settings.musicVolume,
    subtitle: { ...settings.subtitle },
    captionHighlight: settings.captionHighlight,
    hookTitle: settings.hookTitle,
    progressBar: settings.progressBar,
    sceneSfx: settings.sceneSfx,
  };
}

export function readChannelKit(): ChannelKit | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const kit = JSON.parse(raw) as Partial<ChannelKit>;
    if (typeof kit.brandName !== "string" || typeof kit.layoutTemplate !== "string" || typeof kit.voice !== "string") return null;
    return kit as ChannelKit;
  } catch {
    return null;
  }
}

export function saveChannelKit(settings: ProjectSettings): ChannelKit {
  const kit = fromSettings(settings);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kit)); } catch { /* private browsing/storage quota */ }
  return kit;
}

export function applyChannelKit(settings: ProjectSettings, kit: ChannelKit): ProjectSettings {
  return { ...settings, ...kit, subtitle: { ...settings.subtitle, ...kit.subtitle } };
}

