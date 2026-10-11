import { z } from "zod";

/**
 * What the owner chooses in Cài đặt about the machines that share the AI work: which ones are switched off, and how the
 * work is split. Kept in one small file in the private bucket (see balancer-store.ts) so the API writes it and the worker
 * follows it without a database migration.
 */
export const balancerModeSchema = z.enum(["auto", "single", "parallel"]);
export type BalancerMode = z.infer<typeof balancerModeSchema>;

export const nodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/u);

export const balancerSettingsSchema = z.object({
  /** null: whatever AI_BALANCE_MODE says. */
  mode: balancerModeSchema.nullable().default(null),
  /** Machines that take no new work (they are still watched). */
  disabled: z.array(nodeIdSchema).max(16).default([]),
});
export type BalancerSettings = z.infer<typeof balancerSettingsSchema>;

export const DEFAULT_BALANCER_SETTINGS: BalancerSettings = { mode: null, disabled: [] };

/** The saved file as settings; anything unreadable counts as "nothing chosen" so a damaged file cannot stop the work. */
export function parseBalancerSettings(text: string | null | undefined): BalancerSettings {
  if (!text) return { ...DEFAULT_BALANCER_SETTINGS };
  try {
    const parsed = balancerSettingsSchema.safeParse(JSON.parse(text));
    return parsed.success ? { mode: parsed.data.mode, disabled: [...new Set(parsed.data.disabled)] } : { ...DEFAULT_BALANCER_SETTINGS };
  } catch {
    return { ...DEFAULT_BALANCER_SETTINGS };
  }
}

/** The machines that really are off: only ones that exist, and never all of them (something has to do the work). */
export function effectiveDisabled(nodeIds: readonly string[], disabled: readonly string[]): string[] {
  const known = [...new Set(disabled.filter((id) => nodeIds.includes(id)))];
  return known.length >= nodeIds.length ? [] : known;
}
