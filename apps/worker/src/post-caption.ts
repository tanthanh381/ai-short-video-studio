/**
 * Ready-to-post text for a finished video: a title, one or two sentences and a few hashtags. Faceless channels
 * post many videos a day, so this replaces copying the script into the caption by hand.
 */
export type PostCaption = { title: string; description: string; hashtags: string[] };

const STYLE_TAGS: Record<string, string[]> = {
  "ke-chuyen": ["#kechuyen", "#truyenhay"],
  "kien-thuc": ["#kienthuc", "#bancobiet"],
  "truyen-cam-hung": ["#truyencamhung", "#songtichcuc"],
  "meo-cuoc-song": ["#meohay", "#meocuocsong"],
};

/** "#Truyện Cổ Tích" -> "#truyencotich": no diacritics or spaces, as Vietnamese short-video tags are written. */
export function normalizeHashtag(tag: string): string {
  const body = tag.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase().replace(/[^a-z0-9_]/gu, "");
  return body.length >= 2 && body.length <= 30 ? `#${body}` : "";
}

/** Every run of 1-4 consecutive words of the text, written as a hashtag body ("tiết kiệm tiền" -> "tietkiemtien"). */
function phraseTags(text: string): Set<string> {
  const words = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  const tags = new Set<string>();
  for (let i = 0; i < words.length; i++)
    for (let n = 1; n <= 4 && i + n <= words.length; n++) tags.add(words.slice(i, i + n).join(""));
  return tags;
}

/**
 * Clean, de-duplicated hashtags plus the style's own tags. With the script given, a model tag is kept only when it
 * is a phrase of the script or title: small models invent garbled tags ("#tienvucap") that hurt reach.
 */
export function cleanHashtags(tags: unknown[], style: string, text?: string): string[] {
  const unique = new Set<string>();
  const known = text ? phraseTags(text) : null;
  for (const tag of tags) if (typeof tag === "string") {
    const clean = normalizeHashtag(tag);
    if (clean && (!known || known.has(clean.slice(1)))) unique.add(clean);
  }
  for (const tag of STYLE_TAGS[style] ?? []) unique.add(tag);
  return [...unique].slice(0, 6);
}

/** Without a model: the script's first sentence as description, the project title, and style tags. */
export function fallbackPostCaption(script: string, title: string, style: string): PostCaption {
  const sentences = script.normalize("NFC").split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  let description = "";
  for (const sentence of sentences) {
    if ((description + " " + sentence).trim().length > 200) break;
    description = `${description} ${sentence}`.trim();
  }
  return { title: title.trim().slice(0, 80), description: description || script.trim().slice(0, 200), hashtags: cleanHashtags([], style) };
}

/** The description field stores the caption as it is pasted on TikTok/Reels/Shorts: text, blank line, tags. */
export function formatPostCaption(caption: PostCaption): string {
  return caption.hashtags.length ? `${caption.description}\n\n${caption.hashtags.join(" ")}` : caption.description;
}
