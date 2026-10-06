export const appConfig = {
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  demoMode:
    import.meta.env.VITE_DEMO_MODE === "true" ||
    !import.meta.env.VITE_SUPABASE_URL ||
    !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
