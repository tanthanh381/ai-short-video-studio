export const BATCH_MAX_ITEMS = 20;

/** Split a creator's paste into independent ideas without sending empty or tiny jobs to the queue. */
export function parseBatchIdeas(value: string, maxItems = BATCH_MAX_ITEMS): string[] {
  return value
    .split(/\n\s*\n/u)
    .map((item) => item.replace(/\s+/gu, " ").trim())
    .filter((item) => item.length >= 10)
    .slice(0, maxItems);
}
