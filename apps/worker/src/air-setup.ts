import { z } from "zod";
import type { AirSetupSummary } from "@studio/shared";

const stepSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(["pending", "running", "done", "failed"]),
  detail: z.string().default(""),
});

const statusSchema = z.object({
  active: z.boolean(),
  finished: z.boolean(),
  failed: z.string().nullable(),
  node: z.string(),
  startedAt: z.number(),
  expiresAt: z.number(),
  lastSeenAt: z.number().nullable(),
  steps: z.array(stepSchema),
  models: z.object({ sentBytes: z.number(), totalBytes: z.number() }),
});

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * How far the installation of the second machine has got, read from the one-time bundle server on this machine
 * (local-tools/air_bundle_server.py, GET /status with the node access code). Null when no installation is configured, the server
 * is gone (it stops ten minutes after the Air is done) or it does not answer: the Settings page then shows nothing.
 */
export async function fetchAirSetup(
  baseUrl: string | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<AirSetupSummary | null> {
  if (!baseUrl || !token) return null;
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/u, "")}/status`, { signal: AbortSignal.timeout(2_000), headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const parsed = statusSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const { startedAt, expiresAt, lastSeenAt, ...rest } = parsed.data;
    return { ...rest, startedAt: iso(startedAt), expiresAt: iso(expiresAt), lastSeenAt: lastSeenAt === null ? null : iso(lastSeenAt) };
  } catch {
    return null;
  }
}
