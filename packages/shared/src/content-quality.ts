const GENERIC_HOOKS = /^(?:xin chào(?: các bạn)?|trong video này|hãy cùng tìm hiểu|bạn có biết(?: rằng)?|hôm nay chúng ta sẽ|chào mừng bạn đến với)/iu;
const HOOK_SIGNALS = /[?!]|(?:nhưng|vậy mà|sự thật|ít ai biết|đừng|vì sao|tại sao|nếu|thay vì|chỉ cần|điều bất ngờ)/iu;
const CONCRETE_SIGNALS = /(?:ví dụ|khi|nếu|bởi vì|thay vì|chỉ cần|bước|phút|ngày|đồng|%|[0-9])/iu;
const ENDING_SIGNALS = /(?:hãy nhớ|từ hôm nay|và đó là|cuối cùng|đừng quên|bạn sẽ|khi nhìn lại)/iu;

export type ContentQualityReport = { score: number; feedback: string[] };

/** Cheap, deterministic editorial checks shared by the wizard and the worker. */
export function evaluateContentQuality(script: string): ContentQualityReport {
  const text = script.normalize("NFC").trim();
  const sentences = text.split(/(?<=[.!?…])\s+/u).filter(Boolean);
  const first = sentences[0] ?? text;
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []);
  const feedback: string[] = [];
  let score = 50;
  if (GENERIC_HOOKS.test(first)) {
    score -= 35;
    feedback.push("Mở đầu còn chung chung; thay bằng câu hỏi, mâu thuẫn hoặc kết quả cụ thể.");
  } else if (HOOK_SIGNALS.test(first)) score += 18;
  else feedback.push("Tăng lực hút 3 giây đầu bằng câu hỏi, tương phản, cảnh báo hoặc chi tiết bất ngờ.");
  if (words.length < 8) {
    score -= 20;
    feedback.push("Hook quá ngắn; cần một lời hứa rõ ràng để người xem muốn nghe tiếp.");
  } else if (words.length <= 20) score += 8;
  if (sentences.length < 4) {
    score -= 14;
    feedback.push("Cần đủ nhịp: hook, diễn biến hoặc ví dụ, insight và câu kết đáng nhớ.");
  } else score += 8;
  if (CONCRETE_SIGNALS.test(text)) score += 12;
  else feedback.push("Thêm một tình huống, ví dụ, hành động hoặc con số cụ thể.");
  if (ENDING_SIGNALS.test(text)) score += 8;
  else feedback.push("Kết thúc bằng một insight hoặc câu đọng lại, không dừng đột ngột.");
  const normalized = sentences.map((sentence) => sentence.toLocaleLowerCase("vi").replace(/[0-9]+/gu, "#").replace(/[^\p{L}# ]/gu, "").replace(/\s+/gu, " ").trim());
  const repeated = normalized.length - new Set(normalized).size;
  if (normalized.length >= 5 && repeated / normalized.length > 0.35) {
    score -= 18;
    feedback.push("Các câu đang lặp cùng một ý; mỗi câu cần thêm một bước phát triển hoặc hình ảnh mới.");
  }
  return { score: Math.max(0, Math.min(100, score)), feedback };
}
