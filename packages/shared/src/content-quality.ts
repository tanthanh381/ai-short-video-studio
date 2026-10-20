const GENERIC_HOOKS = /^(?:xin chào(?: các bạn)?|trong video này|hãy cùng tìm hiểu|bạn có biết(?: rằng)?|hôm nay chúng ta sẽ|chào mừng bạn đến với)/iu;
// A compelling Vietnamese hook is not always punctuated as a question. Contrast
// patterns such as "vẫn...", "chưa..." and "càng...càng..." are common in
// short-form scripts and should receive the same credit as an explicit question.
const HOOK_SIGNALS = /[?!]|(?:nhưng|vậy mà|sự thật|ít ai biết|đừng|vì sao|tại sao|nếu|thay vì|chỉ cần|điều bất ngờ|đâu phải|không phải|vẫn\b|chưa\b|càng\b[\s\S]{0,80}\bcàng\b|ai cũng)/iu;
const CONCRETE_SIGNALS = /(?:ví dụ|khi|nếu|bởi vì|thay vì|chỉ cần|bước|phút|ngày|đồng|%|[0-9])/iu;
const ENDING_SIGNALS = /(?:hãy nhớ|từ hôm nay|và đó là|cuối cùng|đừng quên|bạn sẽ|khi nhìn lại)/iu;
const VISUAL_ACTION_SIGNALS = /(?:cầm|mở|đóng|bước|đi bộ|chạy|gọi|viết|đọc|nhìn|đặt|nâng|dọn|rót|uống|tặng|hỏi|trả lời|ngồi|đứng|quay|chạm|bật|tắt|nhặt|gấp|mang|đưa|ôm|mỉm cười|thở|thiền|hold|open|walk|call|write|read|look|place|drink|give|ask)/iu;
const EMOTION_SIGNALS = /(?:sợ|lo|mệt|vui|buồn|bất ngờ|hy vọng|tức giận|nhẹ nhõm|im lặng|nhớ|thương|đau|cười|khóc|thở|chậm lại|mất tiền|quá tải|an toàn|fear|relief|surprise|hope|smile|cry)/iu;
const CTA_SIGNALS = /(?:theo dõi|lưu lại|chia sẻ|bình luận|thử ngay|bắt đầu từ hôm nay|gửi cho|follow|save|share|comment)/iu;
const RETENTION_SIGNALS = /(?:nhưng|vậy mà|đến khi|sau đó|rồi|bước tiếp theo|điều quan trọng|cuối cùng|tưởng rằng|hóa ra|ví dụ|hãy nhớ)/iu;

export type ContentQualityDimension = {
  score: number;
  label: string;
};

export type ContentQualityReport = {
  score: number;
  feedback: string[];
  /** Compact editorial signals for the review step; kept additive for older API clients. */
  dimensions: {
    hook: ContentQualityDimension;
    structure: ContentQualityDimension;
    specificity: ContentQualityDimension;
    ending: ContentQualityDimension;
    repetition: ContentQualityDimension;
    visualAction: ContentQualityDimension;
    emotion: ContentQualityDimension;
    pacing: ContentQualityDimension;
    retention: ContentQualityDimension;
    cta: ContentQualityDimension;
  };
};

export type ContentQualityRecommendationId =
  | "hook"
  | "structure"
  | "specificity"
  | "ending"
  | "visualAction"
  | "emotion"
  | "pacing"
  | "retention"
  | "repetition";

export type ContentQualityRecommendation = {
  id: ContentQualityRecommendationId;
  message: string;
  /** Safe to apply locally without changing the meaning of the script. */
  direct: boolean;
  actionLabel: string;
};

/** Turns the deterministic feedback strings into actions the creator can apply. */
export function contentQualityRecommendations(report: ContentQualityReport): ContentQualityRecommendation[] {
  return report.feedback.map((message): ContentQualityRecommendation => {
    if (message.startsWith("Rút ngắn câu")) return { id: "pacing", message, direct: true, actionLabel: "Rút gọn câu" };
    if (message.startsWith("Mở đầu") || message.startsWith("Tăng lực hút")) return { id: "hook", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Cần đủ nhịp")) return { id: "structure", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Thêm một tình huống")) return { id: "specificity", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Kết thúc")) return { id: "ending", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Thêm hành động")) return { id: "visualAction", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Thêm một sắc thái")) return { id: "emotion", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    if (message.startsWith("Thêm một chuyển ý")) return { id: "retention", message, direct: false, actionLabel: "Tối ưu bằng AI" };
    return { id: "repetition", message, direct: false, actionLabel: "Tối ưu bằng AI" };
  });
}

/**
 * Makes only a safe, meaning-preserving pacing edit. The other recommendations
 * stay as prompts for the selected writer model instead of being guessed by UI code.
 */
export function applyDirectContentRecommendation(script: string, id: ContentQualityRecommendationId): string {
  if (id !== "pacing") return script;
  return script
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+|(?<=[,;:])\s+(?=(?:nhưng|vì|nên|mà|để|khi|nếu)\b)/iu))
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** A short, provider-neutral direction for TTS engines that support prosody hints. */
export function voiceDirectionForScript(script: string): string {
  const text = script.normalize("NFC");
  if (/(?:sợ|lo|cảnh báo|đừng|nguy hiểm|mất tiền|khẩn cấp)/iu.test(text))
    return "Giọng cảnh báo nhưng không gắt; nhấn các từ khóa quan trọng, ngắt ngắn trước kết luận.";
  if (/(?:vui|cười|hy vọng|may mắn|chúc mừng|tuyệt vời)/iu.test(text))
    return "Giọng sáng, ấm và có năng lượng; nhấn nhẹ từ khóa tích cực, tránh đọc đều đều.";
  if (/(?:buồn|đau|nhớ|im lặng|mất mát|cô đơn)/iu.test(text))
    return "Giọng trầm, chậm và đồng cảm; để khoảng nghỉ tự nhiên, không bi lụy.";
  return "Giọng kể tự nhiên, có nhịp; nhấn câu hỏi hoặc từ khóa và ngắt nhẹ giữa các ý.";
}

/**
 * Minimum editorial bar for an AI-written idea before spending time on media.
 * Full scripts supplied by a creator are never rejected by this helper; it is
 * used only by the idea-to-script writer and keeps weak drafts in the rewrite
 * loop instead of exporting a technically valid but unpublishable video.
 */
export function passesIdeaQuality(report: ContentQualityReport): boolean {
  // Keep this gate focused on the failure that is most expensive to discover
  // after rendering: a weak or generic opening. A short, strong question can
  // be fewer than eight words, while concrete detail and ending vary by genre
  // and remain visible as feedback rather than a false hard failure.
  return report.score >= 50
    && report.dimensions.hook.score >= 70
    && report.dimensions.structure.score >= 78;
}

/** Cheap, deterministic editorial checks shared by the wizard and the worker. */
export function evaluateContentQuality(script: string): ContentQualityReport {
  const text = script.normalize("NFC").trim();
  // Creators commonly paste scripts as one beat per line without punctuation.
  // Treat those line breaks as editorial beats too, otherwise the structure
  // gate sees the whole script as one sentence and under-scores a usable draft.
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
  const first = sentences[0] ?? text;
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []);
  const firstWordCount = first.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const feedback: string[] = [];
  let score = 50;
  let hookScore = 52;
  if (GENERIC_HOOKS.test(first)) {
    score -= 35;
    hookScore = 20;
    feedback.push("Mở đầu còn chung chung; thay bằng câu hỏi, mâu thuẫn hoặc kết quả cụ thể.");
  } else if (HOOK_SIGNALS.test(first)) {
    score += 18;
    hookScore = 82;
  } else feedback.push("Tăng lực hút 3 giây đầu bằng câu hỏi, tương phản, cảnh báo hoặc chi tiết bất ngờ.");
  if (firstWordCount < 8) {
    score -= 20;
    if (firstWordCount >= 5 && HOOK_SIGNALS.test(first)) {
      // A compact question such as “Vì sao buông bỏ giúp lòng nhẹ hơn?” can
      // land in three seconds without being padded with filler words.
      hookScore = Math.max(hookScore, 72);
    } else {
      hookScore = Math.min(hookScore, 35);
      feedback.push("Hook quá ngắn; cần một lời hứa rõ ràng để người xem muốn nghe tiếp.");
    }
  } else if (firstWordCount <= 20) {
    score += 8;
    hookScore = Math.min(100, hookScore + 12);
  } else {
    hookScore = Math.min(hookScore, 62);
  }
  let structureScore = 45;
  if (sentences.length < 4) {
    score -= 14;
    feedback.push("Cần đủ nhịp: hook, diễn biến hoặc ví dụ, insight và câu kết đáng nhớ.");
  } else {
    score += 8;
    structureScore = sentences.length >= 5 ? 92 : 78;
  }
  const specific = CONCRETE_SIGNALS.test(text);
  if (specific) score += 12;
  else feedback.push("Thêm một tình huống, ví dụ, hành động hoặc con số cụ thể.");
  const ending = ENDING_SIGNALS.test(text);
  if (ending) score += 8;
  else feedback.push("Kết thúc bằng một insight hoặc câu đọng lại, không dừng đột ngột.");
  const visualAction = VISUAL_ACTION_SIGNALS.test(text);
  if (!visualAction) feedback.push("Thêm hành động hoặc đạo cụ có thể nhìn thấy để hình minh họa bám đúng lời thoại.");
  const emotion = EMOTION_SIGNALS.test(text);
  const pacing = sentences.length >= 4 && sentences.every((sentence) => (sentence.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 32);
  const retention = sentences.length >= 4 && RETENTION_SIGNALS.test(text);
  const cta = CTA_SIGNALS.test(text);
  if (!emotion) feedback.push("Thêm một sắc thái cảm xúc hoặc sự thay đổi trạng thái để giọng đọc có điểm nhấn.");
  if (!pacing) feedback.push("Rút ngắn câu dài để nhịp đọc và phụ đề dễ theo dõi trên điện thoại.");
  if (!retention) feedback.push("Thêm một chuyển ý hoặc bước ngoặt để người xem có lý do nghe tiếp.");
  const normalized = sentences.map((sentence) => sentence.toLocaleLowerCase("vi").replace(/[0-9]+/gu, "#").replace(/[^\p{L}# ]/gu, "").replace(/\s+/gu, " ").trim());
  const repeated = normalized.length - new Set(normalized).size;
  const repetitionScore = normalized.length >= 5 && repeated / normalized.length > 0.35 ? 35 : 92;
  if (normalized.length >= 5 && repeated / normalized.length > 0.35) {
    score -= 18;
    feedback.push("Các câu đang lặp cùng một ý; mỗi câu cần thêm một bước phát triển hoặc hình ảnh mới.");
  }
  const dimensions = {
    hook: { score: Math.max(0, Math.min(100, hookScore)), label: "Hook" },
    structure: { score: structureScore, label: "Mạch kể" },
    specificity: { score: specific ? 88 : 42, label: "Cụ thể" },
    ending: { score: ending ? 88 : 44, label: "Kết thúc" },
    repetition: { score: repetitionScore, label: "Lặp ý" },
    visualAction: { score: visualAction ? 88 : 38, label: "Minh họa" },
    emotion: { score: emotion ? 86 : 44, label: "Cảm xúc" },
    pacing: { score: pacing ? 86 : 48, label: "Nhịp" },
    retention: { score: retention ? 86 : 46, label: "Giữ chân" },
    cta: { score: cta ? 86 : 64, label: "CTA" },
  } as const;
  return { score: Math.max(0, Math.min(100, score)), feedback, dimensions };
}
