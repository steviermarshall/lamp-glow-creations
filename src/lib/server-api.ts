import { getSupabase } from "@/lib/supabase";

/**
 * POST to one of the site's own server routes as the signed-in user: JSON, or a form for an
 * upload. The reply's JSON comes back whatever the status, with { error } on a refusal.
 */
export async function postAsMe<T extends object>(
  path: string,
  body: object | FormData,
): Promise<{ ok: boolean; status: number; data: Partial<T> & { error?: string } }> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const form = body instanceof FormData;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${session.access_token}`,
    },
    body: form ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
  return { ok: res.ok, status: res.status, data };
}
