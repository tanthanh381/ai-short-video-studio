/**
 * Encryption of the account owner's own API keys (AES-256-GCM). Used by the API (write) and the worker (read) only:
 * imported as "@studio/shared/secret-box", never from the web bundle.
 *
 * The server secret (API_KEYS_SECRET) is separate from the Supabase service key on purpose: someone who gets the stored
 * file AND the service key still cannot read a key. Each key is sealed with its own random IV, and the user id and the
 * provider are bound in as authenticated data, so a sealed key copied to another user or provider does not open.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { KEY_PROVIDERS, cleanApiKey, lastFour, type ApiKeySummary, type KeyProvider } from "./api-keys";

export type SealedKey = { iv: string; tag: string; data: string; last4: string; savedAt: string };
export type KeyVault = { v: 1; keys: Partial<Record<KeyProvider, SealedKey>> };

export const MIN_SECRET_LENGTH = 32;

function boxKey(secret: string, userId: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("API_KEYS_SECRET phải dài ít nhất 32 ký tự");
  // One derived key per user: a leaked derived key opens one account's keys, not everyone's.
  return Buffer.from(hkdfSync("sha256", secret, "studio-api-keys/v1", `user:${userId}`, 32));
}

const aad = (userId: string, provider: KeyProvider) => Buffer.from(`${userId}|${provider}`, "utf8");

export function sealKey(secret: string, userId: string, provider: KeyProvider, apiKey: string, now = new Date()): SealedKey {
  const key = cleanApiKey(apiKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", boxKey(secret, userId), iv);
  cipher.setAAD(aad(userId, provider));
  const data = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), last4: lastFour(key), savedAt: now.toISOString() };
}

/** The plain key, or an Error saying (in Vietnamese) why the stored one cannot be opened. */
export function openKey(secret: string, userId: string, provider: KeyProvider, sealed: SealedKey): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", boxKey(secret, userId), Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(aad(userId, provider));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Không đọc được khóa API đã lưu (khóa mã hóa của máy chủ đã đổi?). Hãy nhập lại khóa ở Cài đặt.");
  }
}

export function emptyVault(): KeyVault {
  return { v: 1, keys: {} };
}

export function parseVault(text: string | null | undefined): KeyVault {
  if (!text) return emptyVault();
  try {
    const raw = JSON.parse(text) as { v?: number; keys?: Record<string, unknown> };
    const vault = emptyVault();
    for (const provider of KEY_PROVIDERS) {
      const item = raw.keys?.[provider] as Partial<SealedKey> | undefined;
      if (item && typeof item.iv === "string" && typeof item.tag === "string" && typeof item.data === "string")
        vault.keys[provider] = { iv: item.iv, tag: item.tag, data: item.data, last4: String(item.last4 ?? ""), savedAt: String(item.savedAt ?? "") };
    }
    return vault;
  } catch {
    return emptyVault();
  }
}

export const withKey = (vault: KeyVault, provider: KeyProvider, sealed: SealedKey): KeyVault => ({ v: 1, keys: { ...vault.keys, [provider]: sealed } });

export function withoutKey(vault: KeyVault, provider: KeyProvider): KeyVault {
  const keys = { ...vault.keys };
  delete keys[provider];
  return { v: 1, keys };
}

/** What the website may know: whether a key is saved and its last four characters. */
export function summarizeVault(vault: KeyVault, enabled: boolean): ApiKeySummary {
  const status = (provider: KeyProvider) => {
    const sealed = vault.keys[provider];
    return sealed ? { saved: true, last4: sealed.last4, savedAt: sealed.savedAt } : { saved: false };
  };
  return { enabled, keys: { openai: status("openai"), anthropic: status("anthropic") } };
}

/** Where the vault lives: a private bucket of its own (no client policy, service role only), one small file per user. */
export const VAULT_BUCKET = "app-secrets";
export const vaultPath = (userId: string) => `${userId}/api-keys.json`;
