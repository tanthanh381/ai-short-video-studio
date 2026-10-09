const TIMING_LABEL = /\*{0,2}\[\s*\d+(?:[.,]\d+)?\s*(?:s|giây)?\s*[–—-]\s*\d+(?:[.,]\d+)?\s*(?:s|giây)?\s*(?:[|,/][^\]\n]{0,60})?\]\*{0,2}/giu;
const SECTION_LABEL = /\*{0,2}\[\s*(?:hook|cta|ending|intro|outro|mở đầu|kết(?: bài)?|cảnh\s*\d+|scene\s*\d+)\b[^\]\n]{0,60}\]\*{0,2}/giu;
/** A whole line that only names a production field, e.g. "**Text cuối màn hình:**"; the text after it is kept. */
const FIELD_LINE = /^[ \t]*[*_#]*[ \t]*(?:text[^:\n]{0,40}|phụ đề[^:\n]{0,30}|lời (?:dẫn|đọc)|voice ?over|cảnh\s*\d+[^:\n]{0,30}|hook|cta)[ \t]*[:：][ \t]*[*_]*[ \t]*$/gimu;

/**
 * Remove production markup that is not meant to be spoken or shown as captions: timing/section labels
 * such as "**[0–5s | Hook]**", field-name lines such as "**Text cuối màn hình:**" and Markdown emphasis.
 * Every word of the actual script is kept as written.
 */
export function cleanScriptForNarration(text: string): string {
  const cleaned = text
    .replace(TIMING_LABEL, "")
    .replace(SECTION_LABEL, "")
    .replace(FIELD_LINE, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/\*\*|__/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!cleaned) throw new Error("Kịch bản chỉ gồm nhãn thời gian hoặc ghi chú, không có lời đọc");
  return dropRepeatedText(cleaned);
}

const paragraphKey = (text: string) =>
  text.normalize("NFC").toLocaleLowerCase("vi").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/**
 * Pasted stories often start with a teaser ("Ăn khế trả vàng / Ngày xửa ngày xưa… qua ngày...") that the full text
 * then repeats word for word, and the voice would read the opening twice. Keep the title line, drop the teaser;
 * also drop a long paragraph pasted twice. Short refrains are left alone: repetition there is intentional.
 */
export function dropRepeatedText(text: string): string {
  const paragraphs = text.split(/\n{2,}/u);
  const keys = paragraphs.map(paragraphKey);
  const kept: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    const key = keys[index]!;
    if (wordCount(paragraph) >= 15 && keys.slice(0, index).includes(key)) return;
    const [first = "", ...rest] = paragraph.split("\n");
    const titled = rest.length > 0 && wordCount(first) <= 10 && !/[.!?…:;,]["'”’)]?\s*$/u.test(first.trim());
    const body = titled ? paragraphKey(rest.join("\n")) : key;
    const teaser = wordCount(body) >= 8 && keys.slice(index + 1).some((later) => later !== body && later.startsWith(body));
    if (!teaser) kept.push(paragraph);
    else if (titled) kept.push(`${first.trim()}.`); // the title stays, as its own sentence
  });
  return kept.join("\n\n");
}
