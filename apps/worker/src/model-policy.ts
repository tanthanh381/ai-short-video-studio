import type { ProjectSettings } from "@studio/shared";

export type ModelPolicyConfig = {
  defaultModel: string;
  fastModel: string;
  qualityModel: string;
};

/** Select a preset-aware writer while preserving explicit choices and old projects. */
export function writerModelForSettings(
  settings: Pick<ProjectSettings, "generationPreset" | "localModels">,
  installed: readonly string[],
  config: ModelPolicyConfig,
): string | null {
  const explicit = settings.localModels.storyboard?.trim();
  if (explicit) return explicit;
  const has = (wanted: string) => installed.includes(wanted) || installed.some((name) => name.startsWith(`${wanted}:`));
  const candidate = settings.generationPreset === "quality"
    ? config.qualityModel
    : settings.generationPreset === "fast"
      ? config.fastModel
      : config.defaultModel;
  return has(candidate) ? candidate : config.defaultModel;
}
