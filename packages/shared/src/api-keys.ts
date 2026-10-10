/**
 * Paid AI providers the account owner can use with their own API key ("khóa API"). Web-safe: no Node imports here;
 * the encryption lives in secret-box.ts, which only the API and the worker import.
 */
export const KEY_PROVIDERS = ["openai", "anthropic"] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export const KEY_PROVIDER_INFO: Record<KeyProvider, { name: string; prefix: string; console: string; consoleUrl: string; unlocks: string }> = {
  anthropic: {
    name: "Claude (Anthropic)",
    prefix: "sk-ant-",
    console: "console.anthropic.com",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    unlocks: "viết và chia cảnh kịch bản bằng Claude",
  },
  openai: {
    name: "ChatGPT / OpenAI",
    prefix: "sk-",
    console: "platform.openai.com",
    consoleUrl: "https://platform.openai.com/api-keys",
    unlocks: "viết kịch bản, tạo ảnh, tạo giọng đọc và đồng bộ phụ đề bằng OpenAI",
  },
};

export type KeyStatus = { saved: boolean; last4?: string; savedAt?: string };
export type ApiKeySummary = {
  /** False when the server has no encryption secret: keys cannot be stored, and the page says so. */
  enabled: boolean;
  keys: Record<KeyProvider, KeyStatus>;
};

export function isKeyProvider(value: string): value is KeyProvider {
  return (KEY_PROVIDERS as readonly string[]).includes(value);
}

/** A pasted key without spaces or quotes; null when it cannot be a key of that provider. */
export function cleanApiKey(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/gu, "").trim();
}

/** Vietnamese reason why `key` cannot be a key of `provider`, or null. The key itself is never echoed back. */
export function keyFormatError(provider: KeyProvider, raw: string): string | null {
  const key = cleanApiKey(raw);
  const info = KEY_PROVIDER_INFO[provider];
  if (!key) return "Hãy dán khóa API vào ô nhập.";
  if (/\s/u.test(key)) return "Khóa API không có khoảng trắng; hãy dán lại cho đúng.";
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) return "Khóa API chỉ gồm chữ, số, dấu gạch ngang và gạch dưới.";
  if (!key.startsWith(info.prefix)) return `Khóa ${info.name} bắt đầu bằng "${info.prefix}". Hãy kiểm tra bạn đang dán khóa của nhà cung cấp nào.`;
  if (provider === "openai" && key.startsWith("sk-ant-")) return 'Đây là khóa của Claude (bắt đầu bằng "sk-ant-"), không phải của OpenAI.';
  if (key.length < 30 || key.length > 400) return "Khóa API có độ dài chưa đúng; hãy dán lại toàn bộ khóa.";
  return null;
}

/** "…abcd": enough to recognise the key later, never enough to use it. */
export function lastFour(key: string): string {
  return cleanApiKey(key).slice(-4);
}

export function maskedKey(status: KeyStatus): string {
  return status.saved && status.last4 ? `…${status.last4}` : "";
}
