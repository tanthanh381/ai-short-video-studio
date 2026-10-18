const GENERIC_HOOKS = /^(?:xin chào(?: các bạn)?|trong video này|hãy cùng tìm hiểu|bạn có biết(?: rằng)?|hôm nay chúng ta sẽ|chào mừng bạn đến với)/iu;
// A compelling Vietnamese hook is not always punctuated as a question. Contrast
// patterns such as "vẫn...", "chưa..." and "càng...càng..." are common in
// short-form scripts and should receive the same credit as an explicit question.
const HOOK_SIGNALS = /[?!]|(?:nhưng|vậy mà|sự thật|ít ai biết|đừng|vì sao|tại sao|nếu|thay vì|chỉ cần|điều bất ngờ|đâu phải|không phải|vẫn\b|chưa\b|càng\b[\s\S]{0,80}\bcàng\b|ai cũng)/iu;
const CONCRETE_SIGNALS = /(?:ví dụ|khi|nếu|bởi vì|thay vì|chỉ cần|bước|phút|ngày|đồng|%|[0-9])/iu;
const ENDING_SIGNALS = /(?:hãy nhớ|từ hôm nay|và đó là|cuối cùng|đừng quên|bạn sẽ|khi nhìn lại)/iu;
const VISUAL_ACTION_SIGNALS = /(?:cầm|mở|đóng|bước|đi bộ|chạy|gọi|viết|đọc|nhìn|đặt|nâng|dọn|rót|uống|tặng|hỏi|trả lời|ngồi|đứng|quay|chạm|bật|tắt|nhặt|gấp|mang|đưa|ôm|mỉm cười|thở|thiền|hold|open|walk|call|write|read|look|place|drink|give|ask)/iu;

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
  };
};

/** Cheap, deterministic editorial checks shared by the wizard and the worker. */
export function evaluateContentQuality(script: string): ContentQualityReport {
  const text = script.normalize("NFC").trim();
  const sentences = text.split(/(?<=[.!?…])\s+/u).filter(Boolean);
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
    hookScore = Math.min(hookScore, 35);
    feedback.push("Hook quá ngắn; cần một lời hứa rõ ràng để người xem muốn nghe tiếp.");
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
  } as const;
  return { score: Math.max(0, Math.min(100, score)), feedback, dimensions };
}
