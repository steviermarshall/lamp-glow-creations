import { supabase } from "@/integrations/supabase/client";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

/** Browser-only access to the Lovable Cloud client. Returns null during SSR or when not configured. */
export function getSupabase() {
  if (typeof window === "undefined" || !isSupabaseConfigured) return null;
  return supabase;
}
