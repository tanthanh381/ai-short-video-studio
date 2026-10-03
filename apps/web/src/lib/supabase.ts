import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "./config";

export const supabase: SupabaseClient | null =
  appConfig.supabaseUrl && appConfig.supabaseKey
    ? createClient(appConfig.supabaseUrl, appConfig.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
