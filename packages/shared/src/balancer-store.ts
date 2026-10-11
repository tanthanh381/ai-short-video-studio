import { DEFAULT_BALANCER_SETTINGS, balancerSettingsSchema, parseBalancerSettings, type BalancerSettings } from "./node-settings";
import { VAULT_BUCKET, isMissingStorageObject } from "./secret-box";

/** The file in the private bucket the keys live in: no browser policy reaches it, only the API and the worker (service key). */
export const BALANCER_SETTINGS_PATH = "system/balancer.json";

type Reply<T> = PromiseLike<{ data: T | null; error: unknown }>;
/** The little of a Supabase client these functions use, so tests can stand in for it. */
export type SettingsClient = {
  storage: {
    getBucket(name: string): PromiseLike<{ data: unknown }>;
    createBucket(name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): PromiseLike<{ error: { message: string } | null }>;
    from(bucket: string): {
      download(path: string): Reply<{ text(): Promise<string> }>;
      upload(path: string, body: string, options: { contentType: string; upsert: boolean; cacheControl: string }): PromiseLike<{ error: unknown }>;
    };
  };
};

/** The saved choices; nothing saved yet is "nothing chosen". Any other failure is thrown, so a hiccup never reads as a reset. */
export async function readBalancerSettings(db: SettingsClient): Promise<BalancerSettings> {
  const { data, error } = await db.storage.from(VAULT_BUCKET).download(BALANCER_SETTINGS_PATH);
  if (error) {
    if (await isMissingStorageObject(error)) return { ...DEFAULT_BALANCER_SETTINGS };
    throw error;
  }
  return parseBalancerSettings(data ? await data.text() : null);
}

export async function writeBalancerSettings(db: SettingsClient, settings: BalancerSettings): Promise<void> {
  const clean = balancerSettingsSchema.parse(settings);
  const bucket = await db.storage.getBucket(VAULT_BUCKET);
  if (!bucket.data) {
    const { error } = await db.storage.createBucket(VAULT_BUCKET, { public: false, fileSizeLimit: 65_536, allowedMimeTypes: ["application/json"] });
    if (error && !/already exists|duplicate/iu.test(error.message)) throw error;
  }
  const { error } = await db.storage.from(VAULT_BUCKET).upload(BALANCER_SETTINGS_PATH, JSON.stringify(clean), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw error;
}
