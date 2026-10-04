export const SIGNED_PREVIEW_REFRESH_MS = 4 * 60 * 1000;

export function signedPreviewIsFresh(signedAt: number, now = Date.now()) {
  return now >= signedAt && now - signedAt < SIGNED_PREVIEW_REFRESH_MS;
}

/** Renew access in the background without replacing the playing video's source. */
export function startSignedPreviewRefresh<T>(load: () => Promise<T>, cache: (value: T) => void) {
  let active = true;
  let running = false;
  const timer = setInterval(() => {
    if (!active || running) return;
    running = true;
    void load()
      .then((value) => { if (active) cache(value); })
      .catch(() => { /* Existing video keeps playing during a temporary disconnect. */ })
      .finally(() => { running = false; });
  }, SIGNED_PREVIEW_REFRESH_MS);
  return () => { active = false; clearInterval(timer); };
}

export function restoredPreviewTime(previousTime: number, duration: number) {
  const safeTime = Number.isFinite(previousTime) ? Math.max(0, previousTime) : 0;
  return Number.isFinite(duration) ? Math.min(safeTime, Math.max(0, duration)) : safeTime;
}
