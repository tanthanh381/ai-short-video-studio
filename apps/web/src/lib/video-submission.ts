import type { ProjectSettings } from "@studio/shared";

export type VideoInput = {
  sourceText: string;
  settings?: Partial<ProjectSettings>;
};

const keys = new Map<string, string>();
const prefix = "studio-video-submit:";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

/** Retry the same submission after a lost response without creating another job. */
export async function videoSubmission(input: VideoInput) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(sorted(input))),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `${prefix}${fingerprint}`;
  let key = keys.get(storageKey);
  try { key ??= sessionStorage.getItem(storageKey) ?? undefined; } catch { /* Memory fallback for restricted browsers. */ }
  key ??= crypto.randomUUID();
  keys.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* Never store the script in browser storage. */ }
  return { key, storageKey };
}

export function completeVideoSubmission(storageKey: string) {
  keys.delete(storageKey);
  try { sessionStorage.removeItem(storageKey); } catch { /* Memory fallback. */ }
}

export function projectIsProcessing(jobs: Array<{ status: string }>) {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}
