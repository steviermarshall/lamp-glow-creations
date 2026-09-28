import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lovable Cloud (Supabase) exposes these as VITE_* env vars.
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  import.meta.env["VITE_SUPABASE_ANON_KEY"]) as string | undefined;

let client: SupabaseClient | null = null;

export const isSupabaseConfigured = Boolean(url && key);

/** Browser-only Supabase client. Returns null during SSR or when not configured. */
export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined" || !url || !key) return null;
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
