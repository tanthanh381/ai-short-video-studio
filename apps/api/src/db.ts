import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config";

export function createAdminClient(config: AppConfig) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }) },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
