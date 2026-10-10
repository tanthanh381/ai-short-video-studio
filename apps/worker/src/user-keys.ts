import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeyProvider } from "@studio/shared";
import { VAULT_BUCKET, emptyVault, openKey, parseVault, vaultPath } from "@studio/shared/secret-box";

/**
 * The owner's own API key for `provider`, opened from the encrypted file the website saved for them; null when they
 * saved none. Read for each job, so a key added or removed in Cài đặt takes effect on the next job. The plain key lives
 * only in memory for that job and is never logged.
 */
export async function loadUserKey(db: SupabaseClient, secret: string | undefined, userId: string, provider: KeyProvider): Promise<string | null> {
  if (!secret) return null;
  const { data, error } = await db.storage.from(VAULT_BUCKET).download(vaultPath(userId));
  if (error) {
    const status = String((error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status ?? "");
    if (status === "404" || /not found|does not exist/iu.test(error.message)) return null; // no key saved
    throw new Error("Không đọc được khóa API đã lưu lúc này. Hãy thử lại sau ít phút.");
  }
  const sealed = parseVault(await data.text() || JSON.stringify(emptyVault())).keys[provider];
  return sealed ? openKey(secret, userId, provider, sealed) : null;
}
