/**
 * Story-card layout (9:16 only): coloured canvas with a title banner, a picture band, subtitles under the band
 * and a channel footer — the format of narrated illustrated-story shorts. Pure helpers so they are unit-testable.
 */
export const CARD = {
  width: 1080,
  height: 1920,
  /** Picture band: full width at 16:10, centred vertically a little above the middle. */
  bandY: 625,
  bandH: 675,
  titleTop: 372,
  titleSize: 78,
  titleLineGap: 96,
  /** Subtitles start this far from the top, i.e. just under the band. */
  subtitleTop: 1385,
  footerTop: 1735,
  footerSize: 30,
  gradientTop: "0x4a76a0",
  gradientBottom: "0x264460",
  titleColor: "0xFFE82E",
  footerColor: "0xFFD21F",
  /** Default round badge (brand initials) shown when no logo is uploaded. */
  badgeSize: 200,
  badgeY: 70,
} as const;

export function usesStoryCard(settings: { layoutTemplate?: string; aspectRatio: string }): boolean {
  return settings.layoutTemplate === "story-card" && settings.aspectRatio === "9:16";
}

/** Upper-case Vietnamese title split into at most two balanced lines. */
export function splitCardTitle(title: string, maxCharsPerLine = 19): string[] {
  const words = title.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("vi").split(" ").filter(Boolean);
  if (!words.length) return [];
  const whole = words.join(" ");
  if (whole.length <= maxCharsPerLine) return [whole];
  let best: string[] = [whole];
  let bestScore = Infinity;
  for (let cut = 1; cut < words.length; cut++) {
    const a = words.slice(0, cut).join(" ");
    const b = words.slice(cut).join(" ");
    const score = Math.max(a.length, b.length);
    if (score < bestScore) { best = [a, b]; bestScore = score; }
  }
  // A line that is still too long is shrunk by the renderer; never produce a third line.
  return best;
}

/**
 * Banner title when none was written: the first sentence of 4-9 words (usually the hook), else the script's
 * first clause cut at a comma, never mid-phrase.
 */
export function fallbackCardTitle(text: string, maxWords = 9): string {
  const clean = text.normalize("NFC").trim();
  const sentences = clean.split(/(?<=[.!?…])\s+|\n+/u).map((sentence) => sentence.replace(/[.!?…"“”]+/gu, "").trim()).filter(Boolean);
  const words = (value: string) => value.split(/\s+/u).filter(Boolean);
  const fitting = sentences.find((sentence) => words(sentence).length >= 4 && words(sentence).length <= maxWords);
  const chosen = fitting ?? ((sentences[0] ?? clean).split(/[,;:—-]\s+/u)[0] ?? clean);
  return words(chosen).slice(0, maxWords).join(" ").toLocaleUpperCase("vi");
}

/** Footer in two lines, like "Bản quyền thuộc về:" + channel name. Empty when no brand is set. */
export function cardFooterLines(brandName: string): string[] {
  const brand = brandName.trim();
  return brand ? ["Bản quyền thuộc về:", brand] : [];
}

/** Font size that keeps the longest title line inside the canvas margins. */
export function cardTitleFontSize(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const fit = Math.floor((CARD.width * 0.88) / (longest * 0.66));
  return Math.max(46, Math.min(CARD.titleSize, fit));
}

/** Up to two initials of the channel name for the default badge ("Góc Nhỏ Bình Yên" -> "GN"). */
export function brandInitials(brandName: string): string {
  return brandName.normalize("NFC").trim().split(/\s+/u).filter(Boolean).slice(0, 2)
    .map((word) => [...word][0]!.toLocaleUpperCase("vi")).join("");
}

/**
 * Fixed, strongly colour-coded look for the recurring characters of a story card. A small image model keeps a
 * character recognisable when the outfit is spelled out in the same words every time, which a model-written
 * description (different on every run) cannot guarantee.
 */
const ROLE_LOOKS = {
  mother: "a Vietnamese mother with a black bun, red blouse and brown skirt",
  father: "a Vietnamese father with short black hair, blue shirt and gray trousers",
  grandmother: "a Vietnamese grandmother with gray hair in a bun, green blouse and black trousers",
  grandfather: "a Vietnamese grandfather with white hair and a brown shirt",
  girl: "a little girl with two pigtails and a yellow dress",
  boy: "a little boy with short black hair, a yellow t-shirt and blue shorts",
  woman: "a Vietnamese young woman with long black hair, a white shirt and jeans",
  man: "a Vietnamese young man with short black hair, a gray shirt and jeans",
} as const;

/** True for a folk tale or a story set "in the old days", where modern clothing breaks the picture. */
export function isOldTimeStory(text: string): boolean {
  return /(?<![\p{L}])(?:ngày xửa ngày xưa|thuở xưa|ngày xưa|thời xưa|xưa kia|cổ tích|truyện cổ)(?![\p{L}])/iu.test(text.normalize("NFC"));
}

/**
 * Two siblings as one short phrase. Short on purpose: the image model reads only 77 tokens, and a long cast left no
 * room for the action, so every scene became a line-up. Never "elder": the model draws a white-bearded old man.
 */
function brothersCast(oldTime: boolean): string {
  return oldTime
    ? "two Vietnamese brothers in ancient peasant clothes, the older in a red tunic, the younger in a blue tunic"
    : "two Vietnamese brothers, the older in a red t-shirt, the younger in a blue t-shirt";
}

const word = (source: string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, "iu");
const NOT_A_CHILD = "đường|người|mắt|sông|phố|số|dao|vật|thuyền|tim|ngõ|suối|chim|bướm|mèo|chó|gà|cá|rồng|thú|ốc|nít";

/** Up to two recurring characters, in story order, or "" when the script names no clear role. */
export function castForScript(text: string): string {
  const source = text.normalize("NFC").toLocaleLowerCase("vi");
  // "Hai anh em", "người anh … người em": a story about two siblings, whatever else it mentions.
  if (word("hai anh em|người anh").test(source) && word("người em|em mình|em trai").test(source))
    return brothersCast(isOldTimeStory(source));
  const found: Array<[number, keyof typeof ROLE_LOOKS]> = [];
  const at = (role: keyof typeof ROLE_LOOKS, pattern: RegExp) => {
    const match = pattern.exec(source);
    if (match) found.push([match.index, role]);
  };
  // Parents who "died early" are backstory, not the characters on screen.
  const orphaned = /(?:cha mẹ|bố mẹ|ba mẹ)\s+(?:đều\s+)?(?:mất|qua đời|đã khuất|mất sớm)|mồ côi/u.test(source);
  if (!orphaned) {
    at("mother", word("mẹ|má|mạ"));
    at("father", word("cha|bố|tía"));
  }
  at("grandmother", word("bà nội|bà ngoại|bà"));
  at("grandfather", word("ông nội|ông ngoại|ông"));
  const parentOrGrand = found.length > 0;
  const childWord = new RegExp(`(?<![\\p{L}])(?:con(?! (?:${NOT_A_CHILD}))|cháu|bé|đứa trẻ|em bé)(?![\\p{L}])`, "iu").exec(source);
  if (parentOrGrand && childWord) {
    const boy = word("con trai|bé trai|cậu bé|cháu trai").test(source);
    found.push([childWord.index, boy ? "boy" : "girl"]);
  }
  if (!found.length) {
    at("woman", word("cô ấy|chị ấy|cô gái|người phụ nữ|chị"));
    at("man", word("anh ấy|chàng trai|người đàn ông|anh"));
  }
  const ordered = found.sort((a, b) => a[0] - b[0]).map(([, role]) => role);
  const child = ordered.find((role) => role === "girl" || role === "boy");
  // Never more than two people per scene: the first adult plus the child, else the first two adults.
  const roles = child ? [ordered.find((role) => role !== child)!, child] : ordered.slice(0, 2);
  if (!roles[0]) return "";
  const [first, second] = roles.map((role) => ROLE_LOOKS[role!]);
  if (!second) return first!;
  return `${first}, and ${roles[1] === "girl" ? "her" : roles[1] === "boy" ? "his" : "the"} ${second.replace(/^an? /u, "")}`;
}
