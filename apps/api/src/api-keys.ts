import {
  KEY_PROVIDER_INFO,
  cleanApiKey,
  type ApiKeySummary,
  type KeyProvider,
} from "@studio/shared";
import {
  VAULT_BUCKET,
  emptyVault,
  isMissingStorageObject,
  openKey,
  parseVault,
  sealKey,
  summarizeVault,
  vaultPath,
  withKey,
  withoutKey,
  type KeyVault,
} from "@studio/shared/secret-box";
import type { AppConfig } from "./config";
import type { AdminClient } from "./db";

export type KeyCheck =
  | { ok: true; warning?: string }
  | { ok: false; reason: "invalid" | "unreachable"; message: string };

/**
 * Asks the provider whether it accepts this key, with a call that costs nothing (listing models). Only the owner's own
 * key is sent, and only to the provider's own address. A 401 rejects the key; 403 and 429 mean it was recognised but
 * limited (a restricted key may lack the permission to list models), so it is accepted with a note; a network error or
 * a 5xx says "try again" instead of guessing.
 */
export async function checkKeyWithProvider(
  config: Pick<AppConfig, "OPENAI_BASE_URL" | "ANTHROPIC_BASE_URL">,
  provider: KeyProvider,
  rawKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  const key = cleanApiKey(rawKey);
  const info = KEY_PROVIDER_INFO[provider];
  const request =
    provider === "openai"
      ? { url: `${config.OPENAI_BASE_URL.replace(/\/$/, "")}/models`, headers: { authorization: `Bearer ${key}` } }
      : {
          url: `${config.ANTHROPIC_BASE_URL.replace(/\/$/, "")}/v1/models?limit=1`,
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        };
  let status: number;
  try {
    status = (await fetchImpl(request.url, { headers: request.headers, signal: AbortSignal.timeout(12_000) })).status;
  } catch {
    return { ok: false, reason: "unreachable", message: `Không kết nối được tới ${info.name} để kiểm tra khóa. Hãy thử lại sau ít phút.` };
  }
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401)
    return { ok: false, reason: "invalid", message: `${info.name} từ chối khóa này (sai hoặc đã bị thu hồi). Hãy tạo khóa mới tại ${info.console} rồi dán lại.` };
  if (status === 403 || status === 429)
    return { ok: true, warning: `${info.name} nhận ra khóa nhưng chưa cho kiểm tra đầy đủ (khóa bị giới hạn quyền hoặc hết lượt tạm thời). Khóa sẽ được thử thật khi bạn dùng.` };
  return { ok: false, reason: "unreachable", message: `${info.name} đang trả lỗi ${status}. Hãy thử lại sau ít phút.` };
}

/**
 * The owner's API keys, encrypted (AES-256-GCM, secret from API_KEYS_SECRET) in a private bucket of their own that no
 * browser policy can reach. The website only ever learns whether a key is saved and its last four characters.
 */
export function createKeyVault(db: AdminClient, config: Pick<AppConfig, "API_KEYS_SECRET">) {
  const secret = config.API_KEYS_SECRET;
  const enabled = Boolean(secret);
  let bucketReady = false;

  async function ensureBucket() {
    if (bucketReady) return;
    const { data } = await db.storage.getBucket(VAULT_BUCKET);
    if (!data) {
      const { error } = await db.storage.createBucket(VAULT_BUCKET, { public: false, fileSizeLimit: 65_536, allowedMimeTypes: ["application/json"] });
      if (error && !/already exists|duplicate/iu.test(error.message)) throw error;
    }
    bucketReady = true;
  }

  async function read(userId: string): Promise<KeyVault> {
    const { data, error } = await db.storage.from(VAULT_BUCKET).download(vaultPath(userId));
    if (error) {
      // A missing file is an empty vault; any other failure must not look like one (a write would erase the other key).
      if (await isMissingStorageObject(error)) return emptyVault();
      throw error;
    }
    return parseVault(await data.text());
  }

  async function write(userId: string, vault: KeyVault) {
    await ensureBucket();
    const { error } = await db.storage.from(VAULT_BUCKET).upload(vaultPath(userId), JSON.stringify(vault), {
      contentType: "application/json",
      upsert: true,
      cacheControl: "0",
    });
    if (error) throw error;
  }

  return {
    enabled,
    async summary(userId: string): Promise<ApiKeySummary> {
      if (!enabled) return summarizeVault(emptyVault(), false);
      return summarizeVault(await read(userId), true);
    },
    async save(userId: string, provider: KeyProvider, apiKey: string): Promise<ApiKeySummary> {
      if (!secret) throw new Error("Máy chủ chưa bật lưu khóa API");
      const vault = withKey(await read(userId), provider, sealKey(secret, userId, provider, apiKey));
      await write(userId, vault);
      return summarizeVault(vault, true);
    },
    async remove(userId: string, provider: KeyProvider): Promise<ApiKeySummary> {
      if (!secret) return summarizeVault(emptyVault(), false);
      const vault = withoutKey(await read(userId), provider);
      await write(userId, vault);
      return summarizeVault(vault, true);
    },
    /** For tests and diagnostics only; the API itself never reads a plain key back. */
    async open(userId: string, provider: KeyProvider): Promise<string | null> {
      if (!secret) return null;
      const sealed = (await read(userId)).keys[provider];
      return sealed ? openKey(secret, userId, provider, sealed) : null;
    },
  };
}

export type KeyVaultService = ReturnType<typeof createKeyVault>;
