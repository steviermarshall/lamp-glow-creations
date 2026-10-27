import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { clearDraft, loadDraft, type Draft } from "@/lib/apply";
import { logActivity } from "@/lib/track";

/** Current Supabase session. `loading` is true until the first check finishes. */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      if (event === "SIGNED_IN") void logActivity("sign_in");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function authRedirectUrl(path = "/account") {
  return `${window.location.origin}${path}`;
}

let saving: Promise<boolean> | null = null;

/** Saves a pending /apply draft to the signed-in user's account, then clears it. */
export function saveDraftToAccount(userId: string, email: string | undefined) {
  // Guard against double inserts when several components/effects call this at once.
  saving ??= insertDraft(userId, email).finally(() => {
    saving = null;
  });
  return saving;
}

async function insertDraft(userId: string, email: string | undefined) {
  const sb = getSupabase();
  const draft: Draft | null = loadDraft();
  if (!sb || !draft) return false;
  const { answers, utm } = draft;
  const { error } = await sb.from("applications").insert({
    user_id: userId,
    answers,
    utm,
    first_name: answers.firstName ?? null,
    business_name: answers.businessName ?? null,
    phone: answers.phone ?? null,
    email: email ?? answers.email ?? null,
  });
  if (error) throw error;
  clearDraft();
  return true;
}

/** Records the lead as soon as we have an email, so unfinished sign-ups aren't lost. */
export async function recordLead(draft: Omit<Draft, "savedAt">) {
  if (!getSupabase() || !draft.answers.email) return;
  // through the site's server, which takes only these fields and limits each network
  await fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: draft.answers.email,
      first_name: draft.answers.firstName ?? null,
      answers: draft.answers,
      utm: draft.utm,
    }),
  });
}
