// Pure pieces of Lamp's own visit and activity tracking: what a row may hold, and reading a device,
// a browser and a traffic source out of what the request says. No network and no database here,
// so it's unit-tested in tests/tracking.test.ts. The routes use it through tracking.server.ts.

export const SITE_EVENT_KINDS = ["page_view", "apply_step"] as const;
export type SiteEventKind = (typeof SITE_EVENT_KINDS)[number];

export const ACTIVITY_ACTIONS = [
  "sign_in",
  "open_file",
  "change_stage",
  "download_pdf",
  "send_to_funders",
  "send_application",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_LABEL: Record<ActivityAction, string> = {
  sign_in: "Signed in",
  open_file: "Opened a file",
  change_stage: "Changed a stage",
  download_pdf: "Downloaded an application PDF",
  send_to_funders: "Sent a file to funders",
  send_application: "Sent application links",
};

/** Trimmed text of at most `max` characters, or null when empty or not a string. */
export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // control characters become spaces
  const t = [...v]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    .trim();
  return t ? t.slice(0, max) : null;
}

export function isBot(ua: string): boolean {
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime/i.test(
    ua,
  );
}

export function deviceOf(ua: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}

/** "Chrome on Mac", "Safari on iPhone"… */
export function browserOf(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua) || /CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Where a visit came from, in words: a campaign, a search engine, social, another site, or direct. */
export function sourceOf(row: { utm_source: string | null; referrer_host: string | null }): string {
  const utm = row.utm_source?.toLowerCase().trim();
  if (utm) {
    if (/^(ig|insta)/.test(utm)) return "Instagram";
    if (/^(fb|facebook|meta)/.test(utm)) return "Facebook";
    if (/google/.test(utm)) return "Google";
    return utm;
  }
  const host = row.referrer_host?.toLowerCase().replace(/^www\./, "") ?? "";
  if (!host || host === "getlamp.app" || host.endsWith(".getlamp.app")) return "Direct";
  if (/(^|\.)google\./.test(host)) return "Google";
  if (/bing\.com$|duckduckgo\.com$|yahoo\.com$/.test(host)) return "Other search";
  if (/instagram\.com$/.test(host)) return "Instagram";
  if (/facebook\.com$|fb\.com$/.test(host)) return "Facebook";
  if (/linkedin\.com$|lnkd\.in$/.test(host)) return "LinkedIn";
  if (/t\.co$|twitter\.com$|x\.com$/.test(host)) return "X";
  if (/lovable\.(app|dev)$/.test(host)) return "Lovable preview";
  return host;
}

/** A browser's random id, kept in its local storage: 16 to 40 hex digits and dashes. */
export const VISITOR_RE = /^[0-9a-f-]{16,40}$/;

// ---------- the dashboard's website and activity numbers ----------

export type SiteEventRow = {
  occurred_at: string;
  visitor: string;
  kind: string;
  path: string;
  step: number | null;
  question: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
};

export type ActivityRow = {
  occurred_at: string;
  user_id: string | null;
  email: string | null;
  action: string;
  application_id: string | null;
  detail: string | null;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
};

type Span = { from: Date | null; to: Date; prev: { from: Date; to: Date } | null };

const inSpan = (iso: string, from: Date | null, to: Date) => {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && (from === null || t >= from.getTime()) && t < to.getTime();
};

export function placeText(r: {
  city: string | null;
  region: string | null;
  country: string | null;
}) {
  return [r.city, r.region, r.country].filter(Boolean).join(", ") || "Unknown";
}

const top = <T extends string>(counts: Map<T, number>, n: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

/** Visits, where they came from, and how far into /apply each visitor got. */
export function buildWebsite(rows: SiteEventRow[], span: Span) {
  const views = (from: Date | null, to: Date) =>
    rows.filter((r) => r.kind === "page_view" && inSpan(r.occurred_at, from, to));
  const now = views(span.from, span.to);
  const before = span.prev ? views(span.prev.from, span.prev.to) : null;
  const visitorsOf = (rs: SiteEventRow[]) => new Set(rs.map((r) => r.visitor)).size;

  // a visitor's source is where their first visit in the period came from
  const firstVisit = new Map<string, SiteEventRow>();
  for (const r of [...now].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)))
    if (!firstVisit.has(r.visitor)) firstVisit.set(r.visitor, r);
  const sources = new Map<string, number>();
  const devices = new Map<string, number>();
  const places = new Map<string, number>();
  for (const r of firstVisit.values()) {
    const s = sourceOf(r);
    sources.set(s, (sources.get(s) ?? 0) + 1);
    const d = r.device ?? "unknown";
    devices.set(d, (devices.get(d) ?? 0) + 1);
    const p = placeText(r);
    places.set(p, (places.get(p) ?? 0) + 1);
  }
  const pages = new Map<string, number>();
  for (const r of now) pages.set(r.path, (pages.get(r.path) ?? 0) + 1);

  // /apply: the furthest step each visitor reached, then how many reached each step
  const steps = rows.filter(
    (r) => r.kind === "apply_step" && r.step !== null && inSpan(r.occurred_at, span.from, span.to),
  );
  const furthest = new Map<string, number>();
  const label = new Map<number, string>();
  for (const r of steps) {
    furthest.set(r.visitor, Math.max(furthest.get(r.visitor) ?? -1, r.step!));
    if (r.question && !label.has(r.step!)) label.set(r.step!, r.question);
  }
  const maxStep = Math.max(-1, ...furthest.values());
  const apply = Array.from({ length: maxStep + 1 }, (_, step) => ({
    step,
    question: label.get(step) ?? `step ${step + 1}`,
    visitors: [...furthest.values()].filter((s) => s >= step).length,
  }));

  return {
    views: { now: now.length, prev: before ? before.length : null },
    visitors: { now: visitorsOf(now), prev: before ? visitorsOf(before) : null },
    sources: top(sources, 8),
    pages: top(pages, 8),
    devices: top(devices, 3),
    places: top(places, 6),
    apply,
  };
}

/** Sign-ins with where and on what, flagged when a place or browser is new for that person. */
export function buildActivity(rows: ActivityRow[], span: Span) {
  const sorted = [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const seenPlace = new Map<string, Set<string>>();
  const seenBrowser = new Map<string, Set<string>>();
  const signIns: (ActivityRow & { newPlace: boolean; newBrowser: boolean })[] = [];
  for (const r of sorted) {
    if (r.action !== "sign_in") continue;
    const who = r.user_id ?? r.email ?? "?";
    const place = placeText(r);
    const browser = r.browser ?? "?";
    const places = seenPlace.get(who) ?? new Set();
    const browsers = seenBrowser.get(who) ?? new Set();
    // a person's first sign-in is never "new"; only a change after that is
    const first = places.size === 0;
    const flagged = {
      newPlace: !first && !places.has(place),
      newBrowser: !first && !browsers.has(browser),
    };
    places.add(place);
    browsers.add(browser);
    seenPlace.set(who, places);
    seenBrowser.set(who, browsers);
    if (inSpan(r.occurred_at, span.from, span.to)) signIns.push({ ...r, ...flagged });
  }
  const inPeriod = sorted.filter((r) => inSpan(r.occurred_at, span.from, span.to));
  const people = new Map<string, Map<string, number>>();
  for (const r of inPeriod) {
    const who = r.email ?? "unknown";
    const m = people.get(who) ?? new Map<string, number>();
    m.set(r.action, (m.get(r.action) ?? 0) + 1);
    people.set(who, m);
  }
  return {
    signIns: signIns.reverse().slice(0, 25),
    flagged: signIns.filter((s) => s.newPlace || s.newBrowser).length,
    byPerson: [...people.entries()]
      .map(([email, m]) => ({
        email,
        counts: Object.fromEntries(m) as Partial<Record<string, number>>,
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    recent: inPeriod
      .filter((r) => r.action !== "sign_in")
      .reverse()
      .slice(0, 15),
  };
}
