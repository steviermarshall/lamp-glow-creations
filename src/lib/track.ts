// Browser side of Lamp's own tracking. Page views and /apply steps go to /api/track under a random
// id this browser keeps (nothing personal); a signed-in person's sign-in and staff actions go to
// /api/activity. Staff browsers are left out of site visits. Everything here is best effort.
import { getSupabase } from "@/lib/supabase";
import type { ActivityAction, SiteEventKind } from "@/lib/tracking";

const VISITOR_KEY = "lamp.visitor";
const STAFF_KEY = "lamp.staff";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function visitorId(): string | null {
  const s = store();
  if (!s) return null;
  let id = s.getItem(VISITOR_KEY);
  if (!id || !/^[0-9a-f-]{16,40}$/.test(id)) {
    id = crypto.randomUUID();
    s.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** Called on the staff portal: this browser's own visits stop counting as site traffic. */
export function markStaffBrowser() {
  store()?.setItem(STAFF_KEY, "1");
}

export function track(kind: SiteEventKind, extra: { step?: number; question?: string } = {}) {
  const s = store();
  if (!s || s.getItem(STAFF_KEY)) return;
  const visitor = visitorId();
  if (!visitor) return;
  const url = new URL(window.location.href);
  const body = JSON.stringify({
    visitor,
    kind,
    path: url.pathname,
    referrer: document.referrer || null,
    utm_source: url.searchParams.get("utm_source"),
    utm_medium: url.searchParams.get("utm_medium"),
    utm_campaign: url.searchParams.get("utm_campaign"),
    ...extra,
  });
  try {
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" })))
      return;
  } catch {
    /* fall through to fetch */
  }
  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

const signedInFor = new Set<string>();
/** The same action on the same file within a few seconds is one action (a re-render, a double click). */
const lastSent = new Map<string, number>();
const REPEAT_MS = 5000;

export async function logActivity(
  action: ActivityAction,
  opts: { applicationId?: string | null; detail?: string | null } = {},
) {
  try {
    const sb = getSupabase();
    const session = sb ? (await sb.auth.getSession()).data.session : null;
    if (!session) return;
    // every useAuth on the page hears the same sign-in; report it once
    if (action === "sign_in") {
      if (signedInFor.has(session.user.id)) return;
      signedInFor.add(session.user.id);
    }
    const key = `${action}:${opts.applicationId ?? ""}:${opts.detail ?? ""}`;
    const now = Date.now();
    if (now - (lastSent.get(key) ?? 0) < REPEAT_MS) return;
    lastSent.set(key, now);
    await fetch("/api/activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action,
        application_id: opts.applicationId ?? null,
        detail: opts.detail ?? null,
      }),
      keepalive: true,
    });
  } catch {
    /* the action itself already happened */
  }
}
