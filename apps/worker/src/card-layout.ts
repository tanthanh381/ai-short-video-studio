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

/**
 * Paper stage (9:16 only): one character on plain kraft paper, a caption under it, nothing else on screen — the look
 * of "Đạo lý cổ phong" shorts. The picture is drawn square, its edges fade into a paper of its own backdrop colour,
 * and the character breathes and sways a little while the paper stays still.
 */
export const PAPER = {
  width: 1080,
  height: 1920,
  /** The square picture: centred, its bottom edge where the character stands. */
  // The reference shorts keep the character at ~40-60% of the width with open paper around it.
  stage: 760,
  stageBottom: 1250,
  /** Captions start just under the character. */
  captionTop: 1320,
  /** Share of the picture's side over which its edges fade into the paper. */
  feather: 0.2,
  /** Kraft paper of the reference shorts (measured RGB 211,187,135 through the whole video). */
  paper: [211, 187, 135] as const,
} as const;

/**
 * The one recurring character of a paper-stage video. Short on purpose: the image model reads 77 tokens, and the
 * bridge's style words come first; a 25-word description pushed the scene's action out of the prompt.
 */
export const PAPER_MASCOT = "little chibi boy, topknot hair bun, long olive headband ribbon";

/** Told to the storyboard writer for paper-stage videos: one character on bare paper, never a place. */
export const PAPER_STORYBOARD_STYLE =
  "one small chibi character on plain kraft paper with no scenery: no room, street, forest, sky or landscape. " +
  "Describe only the character's pose, facial expression, gesture and at most one simple prop or one small second figure, in under 20 words";

// Places, backdrops and camera words that turn the bare paper into a scene ("on dusty village road",
// "against grey rain-swept street background", "low angle wide shot", "shallow depth of field").
const SCENERY = /\b(?:road|street|alley|path|forest|woods|bamboo grove|village|town|city|market|room|indoors?|house|home|kitchen|temple|garden|park|field|mountains?|river|lake|sea|beach|sky|clouds?|rain\w*|snow\w*|mist\w*|fog\w*|sunset|sunrise|night|landscape|scenery|background|backdrop|wall|window|door|lighting|light|shadows?|depth of field|bokeh|shot|angle|close-?up|camera|lens|cinematic|textur\w*|paper|beige)\b/iu;

/**
 * The scene prompt for a paper-stage picture: the mascot first (every scene, so the character stays the same), then
 * only the clauses about the character, without places or camera words.
 */
export function paperStagePrompt(prompt: string): string {
  const withoutMascot = prompt.replace(new RegExp(PAPER_MASCOT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu"), "")
    .replace(/a little chibi boy with a topknot hair bun and a long olive headband ribbon, wearing an olive green ancient robe\.?/giu, "")
    .replace(/\b(another|a second|two|other) chibis?\b/giu, "$1 small child")
    .replace(/\b(?:full[- ]body )?(?:a |the |same )?chibi(?: (?:figure|character|boy|girl|kid))?(?: in (?:an? )?olive green robe)?\b/giu, "he");
  // Cut before places ("on dusty road") and before each action ("holding…", "carrying…"), so dropping a place
  // keeps the action that followed it in the same clause.
  const clauses = withoutMascot.split(/(?<=[,.;])\s+|\s+(?=(?:on|in|at|against|through|along|under|beside|near|inside|outside)\s)|\s+(?=\p{L}+ing\s)/iu)
    .map((clause) => clause.trim()).filter((clause) => clause && !SCENERY.test(clause));
  const action = clauses.join(" ").replace(/\s+([,.;])/gu, "$1").replace(/^[,.;\s]+|[,;\s]+$/gu, "").replace(/^he\b\s*/iu, "");
  return `${PAPER_MASCOT}, ${action || "standing calmly"}`;
}

export function usesPaperStage(settings: { layoutTemplate?: string; aspectRatio: string }): boolean {
  return settings.layoutTemplate === "paper-stage" && settings.aspectRatio === "9:16";
}

/**
 * Shifts the picture's colours so its paper becomes the reference kraft, and fades its edges to transparent so it
 * melts into the sheet. The model draws the paper a little green one time and yellow the next; shifting every scene
 * to the same paper keeps the video one sheet, as in the reference shorts.
 */
export function paperFeatherFilter(shift: readonly [number, number, number] = [0, 0, 0], side: number = PAPER.stage): string {
  const fade = Math.round(side * PAPER.feather);
  const [dr, dg, db] = shift;
  return `scale=${side}:${side}:force_original_aspect_ratio=increase:flags=lanczos,crop=${side}:${side},format=rgba,` +
    `geq=r='clip(r(X,Y)+${dr},0,255)':g='clip(g(X,Y)+${dg},0,255)':b='clip(b(X,Y)+${db},0,255)':` +
    `a='255*min(1,min(min(X,W-1-X),min(Y,H-1-Y))/${fade})'`;
}

/** The colour shift from a picture's paper (its lightest corner) to the reference kraft, at most ±60 per channel. */
export function paperShift(corners: Array<[number, number, number]>): [number, number, number] {
  const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;
  if (!corners.length) return [0, 0, 0];
  const paper = corners.reduce((best, corner) => (luma(corner) > luma(best) ? corner : best), corners[0]!);
  return paper.map((value, channel) => Math.max(-60, Math.min(60, PAPER.paper[channel]! - value))) as [number, number, number];
}

/**
 * One scene: the paper (input 2) with the feathered character (input 0) breathing (1.2% scale, 3.4 s) and swaying
 * (0.4°, 4.6 s) from the feet, so it reads as alive without a video model. Phase differs per scene.
 */
export function paperStageFilter(index: number): string {
  const phase = (index % 4) * 0.8;
  return `[0:v]format=rgba,scale=w='trunc(${PAPER.stage}*(1+0.012*sin(2*PI*(t+${phase})/3.4))/2)*2':h=-2:eval=frame,` +
    `rotate=a='0.007*sin(2*PI*(t+${phase})/4.6)':c=none:ow=iw:oh=ih[character];` +
    `[2:v]format=yuv420p[paper];[paper][character]overlay=x='(W-w)/2':y='${PAPER.stageBottom}-h':eval=frame:format=auto,fps=30,format=yuv420p[v]`;
}

/** The kraft sheet: fine grain and a faint vignette. */
export function paperCanvasArgs(output: string, color: string = PAPER_HEX): string[] {
  // A strong vignette darkened the sheet around the picture, whose own paper then showed as a light square.
  return ["-y", "-f", "lavfi", "-i", `color=c=0x${color}:s=${PAPER.width}x${PAPER.height}:d=1,noise=alls=5:allf=u,vignette=PI/14`,
    "-frames:v", "1", "-update", "1", output];
}

/** ffmpeg filters that average one 48 px corner of the picture to a single RGB pixel. */
export const PAPER_CORNERS = ["crop=48:48:0:0", "crop=48:48:iw-48:0", "crop=48:48:0:ih-48", "crop=48:48:iw-48:ih-48"]
  .map((crop) => `${crop},scale=1:1:flags=area`);

/** The sheet's colour as ffmpeg hex. */
export const PAPER_HEX = PAPER.paper.map((value) => value.toString(16).padStart(2, "0")).join("");

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

/** The people a story is about: the English word an image model reads ("Japanese") and their country ("Japan"). */
export type Nationality = { people: string; country: string };
export const VIETNAMESE: Nationality = { people: "Vietnamese", country: "Vietnam" };

type Origin = Nationality & { named: RegExp; after: RegExp | null };

// A country is only a country after a word that introduces one ("người Nhật", "ở Pháp"): "Chủ Nhật" is Sunday and
// "pháp luật" is law. The first letter of that word may be a capital at the start of a sentence.
const BEFORE_COUNTRY = "(?:[Nn]gười|[Nn]ước|[Dd]ân|[Xx]ứ|[Đđ]ất|[Ởở]|[Tt]ại|[Ss]ang|[Đđ]ến|[Vv]ề|[Cc]ủa|[Vv]ăn hóa|[Ẩẩ]m thực|[Mm]ón|[Nn]ền)";

/**
 * `names` are unambiguous in any letter case ("Nhật Bản"). `proper` is a short name that is also an ordinary Vietnamese
 * word (nhật = diary/day, mỹ = beauty, đức = virtue): it counts only capitalised and right after a word like "người".
 */
function origin(people: string, country: string, names: string, proper?: string): Origin {
  return {
    people,
    country,
    named: new RegExp(`(?<![\\p{L}])(?:${names})(?![\\p{L}])`, "giu"),
    // Not "Nhật Bản" / "Hàn Quốc": `names` already counts those, and one mention must not count twice.
    after: proper ? new RegExp(`(?<![\\p{L}])${BEFORE_COUNTRY}\\s+(?:${proper})(?![\\p{L}])(?!\\s+(?:Quốc|Bản)(?![\\p{L}]))`, "gu") : null,
  };
}

const ORIGINS: Origin[] = [
  origin("Vietnamese", "Vietnam", "việt nam|người việt|đất việt|nước ta|đất nước ta|dân ta|hà nội|sài gòn"),
  origin("Japanese", "Japan", "nhật bản|tokyo|osaka|kyoto|okinawa|hokkaido", "Nhật"),
  origin("Korean", "Korea", "hàn quốc|triều tiên|seoul|busan", "Hàn"),
  origin("Chinese", "China", "trung quốc|trung hoa|bắc kinh|thượng hải|quảng châu"),
  origin("American", "the United States", "hoa kỳ|new york|california|washington|silicon valley", "Mỹ"),
  origin("French", "France", "paris|pháp quốc", "Pháp"),
  origin("German", "Germany", "berlin|munich", "Đức"),
  origin("Italian", "Italy", "ý đại lợi|rome", "Ý"),
  origin("Russian", "Russia", "liên xô|moscow", "Nga"),
  origin("British", "Britain", "vương quốc anh|anh quốc|london"),
  origin("Thai", "Thailand", "thái lan|bangkok"),
  origin("Indian", "India", "ấn độ|mumbai|delhi"),
  origin("Australian", "Australia", "nước úc|australia|sydney", "Úc"),
  origin("Spanish", "Spain", "tây ban nha|madrid"),
  origin("Brazilian", "Brazil", "brazil|brasil"),
];

/**
 * Who the story is about, read from the countries and peoples its Vietnamese script names ("người Nhật", "Hàn Quốc",
 * "nước Mỹ"). The most mentioned wins; Vietnamese stays the default when none is named or Vietnam is named as often.
 */
export function storyNationality(text: string): Nationality {
  const source = text.normalize("NFC");
  const count = (pattern: RegExp | null) => (pattern ? source.match(pattern)?.length ?? 0 : 0);
  let best = ORIGINS[0]!;
  let bestCount = count(best.named);
  for (const candidate of ORIGINS.slice(1)) {
    const mentions = count(candidate.named) + count(candidate.after);
    if (mentions > bestCount) { best = candidate; bestCount = mentions; }
  }
  return { people: best.people, country: best.country };
}

/**
 * Puts the story's people where a description says "Vietnamese" ("a Vietnamese mother" -> "an American mother"):
 * the character descriptions and the image model's own habit both default to Vietnamese. Vietnamese things
 * ("Vietnamese ao dai") keep their word.
 */
export function withNationality(text: string, nationality: Nationality): string {
  if (nationality.people === VIETNAMESE.people) return text;
  const article = /^[aeiou]/iu.test(nationality.people) ? "n" : "";
  return text
    .replace(/\b(a)n?(\s+)Vietnamese\b(?!\s+(?:ao dai|pagoda|temple))/giu, (_all, a: string, space: string) => `${a}${article}${space}${nationality.people}`)
    .replace(/\bVietnamese\b(?!\s+(?:ao dai|pagoda|temple))/gu, nationality.people);
}

/** True for a folk tale or a story set "in the old days", where modern clothing breaks the picture. */
export function isOldTimeStory(text: string): boolean {
  // Folk tales, and wuxia/court stories that never say "ngày xưa" but are just as much set in the past.
  return /(?<![\p{L}])(?:ngày xửa ngày xưa|thuở xưa|ngày xưa|thời xưa|xưa kia|cổ tích|truyện cổ|kiếm khách|kiếm hiệp|giang hồ|võ lâm|sư môn|sư phụ|triều đình|hoàng thượng|hoàng đế|thái tử|quan lại|lão gia|tiểu thư|cung điện|phong kiến)(?![\p{L}])/iu.test(text.normalize("NFC"));
}

/**
 * Two siblings as one short phrase. Short on purpose: the image model reads only 77 tokens, and a long cast left no
 * room for the action, so every scene became a line-up. Never "elder" or "older": the model draws a white-bearded old man.
 */
function brothersCast(oldTime: boolean): string {
  // "Older" is read as old age by SDXL Base (white-bearded men): say big/little brother and "young".
  return oldTime
    ? "two young Vietnamese brothers in ancient peasant clothes, the big brother in a red tunic, the little brother in a blue tunic"
    : "two young Vietnamese brothers, the big brother in a red t-shirt, the little brother in a blue t-shirt";
}

const word = (source: string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, "iu");
const NOT_A_CHILD = "đường|người|mắt|sông|phố|số|dao|vật|thuyền|tim|ngõ|suối|chim|bướm|mèo|chó|gà|cá|rồng|thú|ốc|nít";

/**
 * Up to two recurring characters, in story order, or "" when the script names no clear role. They are Vietnamese
 * unless the script is about another people (see storyNationality).
 */
export function castForScript(text: string, nationality: Nationality = storyNationality(text)): string {
  return withNationality(roleCast(text), nationality);
}

function roleCast(text: string): string {
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
