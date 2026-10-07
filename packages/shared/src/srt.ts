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
    // noUncheckedIndexedAccess: use explicit non-null since length >= 3 is verified above
    const firstLine = lines[0] ?? "";
    const secondLine = lines[1] ?? "";
    const index = parseInt(firstLine.trim(), 10);
    if (isNaN(index)) continue;
    const timeMatch = secondLine
      .trim()
      .match(
        /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
      );
    if (!timeMatch) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = timeMatch;
    if (!h1 || !m1 || !s1 || !ms1 || !h2 || !m2 || !s2 || !ms2) continue;
    const startMs = toMs(h1, m1, s1, ms1);
    const endMs = toMs(h2, m2, s2, ms2);
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
