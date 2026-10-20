import { looksLikeSubtitles, subtitlesToScript } from "./srt";

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
  // Pasted subtitles (.srt/.vtt content) become plain narration first.
  const source = looksLikeSubtitles(text) ? subtitlesToScript(text) : text;
  const cleaned = source
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

// --- cutting a script into scenes ------------------------------------------------------------------------------------------

/** A scene reads best at about this many words (≈ 5 seconds of narration): long enough for one picture to make sense, short enough to change. */
const TARGET_WORDS = 17;
/** One scene's text never passes this many characters (the database allows 2000). */
const MAX_SCENE_CHARS = 1900;
const FORBIDDEN = 500;

/** Words that begin a new clause: a long sentence is cut in front of them. */
const CLAUSE_STARTERS = new Set(["nhưng", "mà", "còn", "và", "rồi", "nên", "vì", "bởi", "để", "khi", "nếu", "tuy", "dù", "song", "hoặc", "hay"]);
/** Words that cannot end a scene: "của | người", "và | rồi" would leave the thought hanging. */
const HANGING_WORDS = new Set(["của", "và", "là", "thì", "mà", "những", "các", "một", "hai", "ba", "cho", "với", "ở", "trong", "trên", "dưới", "từ", "đến", "bởi", "vì", "để", "như", "rất", "đã", "sẽ", "đang", "không", "chưa", "cũng", "vẫn", "còn", "cả", "mỗi", "từng", "này", "ấy", "đó", "nên", "hay", "hoặc"]);
/** After "…" these words show that the sentence goes on in the next line. */
const CONTINUATION = new Set(["thì", "mà", "nhưng", "và", "còn", "nên", "rồi", "để", "khi", "hay", "hoặc", "bởi", "vì", "nếu", "dù", "tuy", "song"]);
const LIST_MARKER = /^(?:\(?\d{1,2}[.)]\)?|[-•*])$/u;
const ABBREVIATION = /^(?:\p{Lu}|TS|PGS|GS|ThS|BS|KS|TP|TX|Mr|Mrs|Ms|Dr|St|vd|tr)\.["'”’)]*$/u;
const CLOSERS = String.raw`["'”’»)\]]*`;
const SENTENCE_END = new RegExp(String.raw`[.!?。！？]${CLOSERS}$`, "u");
const ELLIPSIS_END = new RegExp(String.raw`(?:…|\.{3})${CLOSERS}$`, "u");
const CLAUSE_END = new RegExp(String.raw`[,;，；]${CLOSERS}$`, "u");

const lower = (word: string) => word.normalize("NFC").toLocaleLowerCase("vi").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const startsUpper = (word: string) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(word);
const startsLower = (word: string) => /^[^\p{L}\p{N}]*\p{Ll}/u.test(word);
const hasWord = (token: string) => /[\p{L}\p{N}]/u.test(token);

/** How bad it is to end a scene after unit `i` (a word with its trailing space): 0 is a sentence end, negative is the author's own line break. */
function breakPenalty(cores: string[], trailing: string[], i: number, sinceClause: number, insideQuote: boolean): number {
  const current = cores[i]!;
  const next = cores[i + 1]!;
  if (LIST_MARKER.test(current)) return FORBIDDEN; // "5." stays with its item
  if (/[:：]["'”’)]*$/u.test(current)) return 60; // an introduction stays with what it introduces
  const newlines = (trailing[i]!.match(/\n/gu) ?? []).length;
  const terminal = SENTENCE_END.test(current) && !ABBREVIATION.test(current);
  const ellipsis = ELLIPSIS_END.test(current);
  let penalty: number;
  const continues = ellipsis && CONTINUATION.has(lower(next)); // "Và khi họ cất tiếng bằng thành tựu…" / "Thì mọi lời giới thiệu…"
  if (ellipsis && sinceClause <= 2) penalty = 35; // "Cuối cùng…" leads into the next line
  else if (continues) penalty = 4;
  else if (terminal || (ellipsis && (newlines > 0 || startsUpper(next)))) {
    penalty = 0;
    // `"Con đi tìm cha ạ." cậu bé đáp.`: the tag after a closing quote belongs to the quote
    if (/["”’»]$/u.test(current) && startsLower(next)) penalty = 25;
  } else if (ellipsis) penalty = 4;
  else if (/[;；—–]$/u.test(current)) penalty = 3;
  else if (CLAUSE_END.test(current)) {
    // A comma normally continues the same spoken thought. Keep it in one
    // scene; the dynamic splitter can still use a conjunction or a sentence
    // boundary when a very long passage must be divided.
    const comma = /[,，]["'”’)\]]*$/u.test(current);
    penalty = comma ? 32 : (CLAUSE_STARTERS.has(lower(next)) ? 2 : 5);
    if (sinceClause <= 2) penalty += 30; // "Lạ thay," / "Thế nhưng,": a lead-in word stays with its sentence
  } else {
    penalty = CLAUSE_STARTERS.has(lower(next)) ? 12 : 40;
    if (HANGING_WORDS.has(lower(current))) penalty += 20;
  }
  if (newlines > 0 && penalty > 3) penalty = 3; // the author ended the line here
  if (insideQuote && penalty > 0) penalty += 15;
  if (newlines >= 2) penalty -= 8; // a paragraph
  else if (newlines === 1) penalty -= 1;
  return penalty;
}

function lengthCost(words: number): number {
  let cost = 0.04 * (words - TARGET_WORDS) ** 2;
  if (words < 6) cost += 25; // a fragment is not a scene
  else if (words < 9) cost += 3;
  if (words > 30) cost += (words - 30) * 3;
  return cost;
}

/**
 * Cuts a script into scenes without changing a character: the slices joined give the input back.
 *
 * Where a scene ends is chosen for the whole script at once (the cheapest set of cuts, by dynamic programming), not one cut at
 * a time: the author's own line and paragraph breaks and sentence ends are the natural places, a long sentence is cut at a
 * comma or in front of "nhưng / mà / còn …" and never inside a thought; short lines are gathered into one scene; an
 * introduction ending in ":" stays with its quote or list, a list number with its item, a quote with the words that name the speaker.
 * About 17 words per scene is what it aims for; a scene is rarely under 9 or over 28.
 */
export function splitScript(sourceText: string): string[] {
  if (!sourceText.trim()) throw new Error("Hãy nhập kịch bản");
  const tokens = sourceText.match(/\S+\s*|\s+/gu) ?? [];
  const units: string[] = [];
  let lead = "";
  for (const token of tokens) {
    if (token.trim()) units.push(lead + token), (lead = "");
    else lead += token;
  }
  if (!units.length) throw new Error("Hãy nhập kịch bản");
  const cores = units.map((unit) => unit.trim());
  const trailing = units.map((unit) => unit.slice(unit.trimEnd().length));
  const count = units.length;

  const wordPrefix = [0];
  const charPrefix = [0];
  units.forEach((unit, index) => {
    wordPrefix.push(wordPrefix[index]! + (hasWord(cores[index]!) ? 1 : 0));
    charPrefix.push(charPrefix[index]! + unit.length);
  });

  // what each possible cut would cost
  const penalties: number[] = new Array(Math.max(0, count - 1));
  let sinceClause = 0;
  let quoteDepth = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const core = cores[i]!;
    sinceClause = hasWord(core) ? sinceClause + 1 : sinceClause;
    quoteDepth += (core.match(/[“«]/gu) ?? []).length - (core.match(/[”»]/gu) ?? []).length;
    const straight = (core.match(/"/gu) ?? []).length;
    if (straight % 2 === 1) quoteDepth += quoteDepth > 0 ? -1 : 1;
    penalties[i] = breakPenalty(cores, trailing, i, sinceClause, quoteDepth > 0);
    if (/[.!?…;:,，；。！？]["'”’)]*$/u.test(core)) sinceClause = 0;
  }

  const best: number[] = new Array(count + 1).fill(Infinity);
  const from: number[] = new Array(count + 1).fill(0);
  best[0] = 0;
  for (let end = 1; end <= count; end += 1) {
    const cut = end < count ? penalties[end - 1]! : 0;
    for (let start = end - 1; start >= 0; start -= 1) {
      if (end - start > 1 && charPrefix[end]! - charPrefix[start]! > MAX_SCENE_CHARS) break;
      const total = best[start]! + lengthCost(wordPrefix[end]! - wordPrefix[start]!) + cut;
      if (total < best[end]!) {
        best[end] = total;
        from[end] = start;
      }
    }
  }
  const slices: string[] = [];
  for (let end = count; end > 0; end = from[end]!) slices.push(units.slice(from[end]!, end).join(""));
  slices.reverse();
  if (slices.some((part) => part.length > 2000)) throw new Error("Kịch bản có một từ quá dài; vui lòng kiểm tra nội dung đã dán");
  if (slices.length > 250) throw new Error("Kịch bản quá dài cho video ngắn");
  return slices;
}

/**
 * A pasted text that is already a finished script, written line by line (one beat per line, most lines ending in a full stop):
 * it should be read as written and cut along the author's lines, not handed to the model to be rewritten as an "idea".
 * A single block of prose, a topic or a loose list of points is not one.
 */
export function looksLikeFinishedScript(text: string): boolean {
  const lines = text.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 8 || wordCount(text) < 120) return false;
  const lengths = lines.map(wordCount).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)]!;
  const ended = lines.filter((line) => /[.!?…:;,]["'”’)]*$/u.test(line)).length / lines.length;
  return median <= 28 && ended >= 0.6;
}
