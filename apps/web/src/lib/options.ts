import { DEFAULT_VOICE_PRESET, isVoicePreset, type ProjectSettings } from "@studio/shared";

/** The voices OpenAI's speech API accepts; the local voices (doc-truyen, ...) are names of this site's own presets. */
export const OPENAI_VOICES = [
  { id: "alloy", label: "Ấm, trung tính" },
  { id: "nova", label: "Sáng, tự nhiên" },
  { id: "onyx", label: "Trầm, điềm tĩnh" },
] as const;

export function isOpenAiVoice(voice: string): boolean {
  return OPENAI_VOICES.some((item) => item.id === voice);
}

/**
 * Switching where pictures and voices are made also switches to a voice that provider knows: a local preset sent to OpenAI
 * (or "alloy" sent to the local bridge) makes every scene fail at the voice step.
 */
export function withMediaProvider(settings: ProjectSettings, mediaProvider: ProjectSettings["mediaProvider"]): ProjectSettings {
  const voice = mediaProvider === "openai"
    ? (isOpenAiVoice(settings.voice) ? settings.voice : "alloy")
    : (isVoicePreset(settings.voice) ? settings.voice : DEFAULT_VOICE_PRESET);
  return { ...settings, mediaProvider, voice };
}

/** The story card already has its own title; a second big title over the first seconds would stack on it. */
export function hookTitleAllowed(settings: Pick<ProjectSettings, "layoutTemplate">): boolean {
  return settings.layoutTemplate !== "story-card";
}
