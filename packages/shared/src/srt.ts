export type SrtEntry = { index: number; startMs: number; endMs: number; text: string };

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3_600_000 +
    parseInt(m, 10) * 60_000 +
    parseInt(s, 10) * 1_000 +
    parseInt(ms, 10)
  );
}

export function parseSrt(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;
    const timeMatch = lines[1]
      .trim()
      .match(
        /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
      );
    if (!timeMatch) continue;
    const startMs = toMs(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endMs = toMs(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    if (endMs <= startMs) continue;
    const text = lines
      .slice(2)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]+\}/g, "")
      .trim();
    if (text) entries.push({ index, startMs, endMs, text });
  }
  return entries;
}
