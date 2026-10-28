// Server side of Lamp's own tracking: POST /api/track (a page view or an /apply step, from any
// visitor, no login) and POST /api/activity (a signed-in person's sign-in or staff action). Both
// write with the service role into tables only admins can read (migration
// 20261027180000_site_and_activity_tracking.sql). Never import this file from browser code.
import { caller, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import {
  ACTIVITY_ACTIONS,
  browserOf,
  deviceOf,
  isBot,
  SITE_EVENT_KINDS,
  text,
  VISITOR_RE,
  type ActivityAction,
  type SiteEventKind,
} from "@/lib/tracking";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2048;
/** A sign-in is logged once per person per half hour, however many tabs report it. */
const SIGN_IN_WINDOW_MS = 30 * 60_000;

const notReady = () =>
  !SUPABASE_URL() || !SERVICE_KEY() ? new Response(null, { status: 204 }) : null;

/** Where the request came from, from what the host (Cloudflare) adds: country always, city when on. */
function placeOf(request: Request) {
  const h = request.headers;
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const t = text(typeof v === "string" ? decodeURIComponent(v) : v, 80);
      if (t && t !== "XX" && t !== "T1") return t;
    }
    return null;
  };
  const country = pick(h.get("cf-ipcountry"), cf["country"]);
  return {
    country: country && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : null,
    region: pick(h.get("cf-region"), cf["region"]),
    city: pick(h.get("cf-ipcity"), cf["city"]),
  };
}

function ipOf(request: Request): string | null {
  const h = request.headers;
  const ip =
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0] ||
    h.get("x-real-ip") ||
    "";
  return text(ip, 64);
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /api/track: { visitor, kind, path, step?, question?, referrer?, utm_* }. Always 204. */
export async function recordSiteEvent(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const nr = notReady();
  if (nr) return nr;
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || isBot(ua)) return done;
  const b = await body(request);
  if (!b) return done;
  const visitor = text(b["visitor"], 40);
  const kind = b["kind"] as SiteEventKind;
  const path = text(b["path"], 200);
  if (
    !visitor ||
    !VISITOR_RE.test(visitor) ||
    !SITE_EVENT_KINDS.includes(kind) ||
    !path?.startsWith("/")
  )
    return done;
  if (path.startsWith("/staff") || path.startsWith("/api")) return done;
  let referrerHost: string | null = null;
  const ref = text(b["referrer"], 300);
  if (ref) {
    try {
      referrerHost = text(new URL(ref).hostname, 120);
    } catch {
      /* not a URL */
    }
  }
  const step = Number(b["step"]);
  await service()
    .from("site_events" as never)
    .insert({
      visitor,
      kind,
      path,
      step: Number.isInteger(step) && step >= 0 && step <= 50 ? step : null,
      question: text(b["question"], 40),
      referrer_host: referrerHost,
      utm_source: text(b["utm_source"], 80),
      utm_medium: text(b["utm_medium"], 80),
      utm_campaign: text(b["utm_campaign"], 120),
      device: deviceOf(ua),
      ...placeOf(request),
    } as never);
  return done;
}

/** POST /api/activity, signed in: { action, application_id?, detail? }. */
export async function recordActivity(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const b = await body(request);
  const action = b?.["action"] as ActivityAction;
  if (!b || !ACTIVITY_ACTIONS.includes(action)) return json(400, { error: "Unknown action." });
  const appId =
    typeof b["application_id"] === "string" && UUID.test(b["application_id"])
      ? b["application_id"]
      : null;
  const svc = service();
  if (action === "sign_in") {
    const recent = await svc
      .from("activity_log" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", who.userId)
      .eq("action", "sign_in")
      .gte("occurred_at", new Date(Date.now() - SIGN_IN_WINDOW_MS).toISOString());
    if ((recent.count ?? 0) > 0) return new Response(null, { status: 204 });
  }
  const profile = await svc.from("profiles").select("email").eq("id", who.userId).maybeSingle();
  const ua = request.headers.get("user-agent") ?? "";
  await svc.from("activity_log" as never).insert({
    user_id: who.userId,
    email: text((profile.data as { email?: string } | null)?.email, 254),
    action,
    application_id: appId,
    detail: text(b["detail"], 200),
    ip: ipOf(request),
    device: deviceOf(ua),
    browser: text(browserOf(ua), 60),
    ...placeOf(request),
  } as never);
  return new Response(null, { status: 204 });
}

/**
 * GET /application/<rep>/pdf: a PDF carries no visitor id, so each open is counted as its own
 * visitor's page view of that path, the way /api/track counts pages. Unknown reps and bots aren't
 * counted. Best effort: never throws.
 */
export async function recordPdfOpen(request: Request, slug: string): Promise<void> {
  if (notReady()) return;
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || isBot(ua) || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(slug)) return;
  try {
    const svc = service();
    const rep = await svc.from("reps").select("active").eq("slug", slug).maybeSingle();
    if (rep.error || !(rep.data as { active: boolean } | null)?.active) return;
    let referrerHost: string | null = null;
    try {
      const ref = request.headers.get("referer");
      referrerHost = ref ? text(new URL(ref).hostname, 120) : null;
    } catch {
      /* not a URL */
    }
    const url = new URL(request.url);
    await svc.from("site_events" as never).insert({
      visitor: crypto.randomUUID(),
      kind: "page_view",
      path: `/application/${slug}/pdf`,
      step: null,
      question: null,
      referrer_host: referrerHost,
      utm_source: text(url.searchParams.get("utm_source"), 80),
      utm_medium: text(url.searchParams.get("utm_medium"), 80),
      utm_campaign: text(url.searchParams.get("utm_campaign"), 120),
      device: deviceOf(ua),
      ...placeOf(request),
    } as never);
  } catch {
    /* counting is best effort; the form still opens */
  }
}
