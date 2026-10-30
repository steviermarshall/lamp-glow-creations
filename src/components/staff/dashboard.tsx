import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Loader2, Minus, RefreshCw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { STAGE_LABEL, type Stage } from "@/lib/staff";
import { usd } from "@/lib/money";
import { QUESTIONS } from "@/lib/apply";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVITY_LABEL,
  buildActivity,
  buildWebsite,
  placeText,
  type ActivityAction,
  type ActivityRow,
  type SiteEventRow,
} from "@/lib/tracking";
import {
  buildDashboard,
  delta,
  PERIODS,
  periodRange,
  STUCK_DAYS,
  CLAWBACK_DAYS,
  type Cmp,
  type DashboardData,
  type PeriodKey,
} from "@/lib/dashboard";

const PAGE = 1000;
const MAX_PAGES = 50;

/** Reads every row a query returns, a thousand at a time (the database hands back at most that). */
async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) return null;
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * When each file was signed. Staff can't read application_details from the browser (it holds
 * SSNs), so Lamp's server reads just the signing times for the files this person can see.
 */
async function signedTimes(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<Record<string, unknown>[] | null> {
  const session = (await sb.auth.getSession()).data.session;
  if (!session) return null;
  const r = await fetch("/api/staff/signed", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { signed?: Record<string, unknown>[] } | null;
  return j?.signed ?? null;
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function load(isAdmin: boolean): Promise<Loaded> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign-in isn't available yet.");
  const failed: string[] = [];
  const got = <T,>(name: string, rows: T[] | null) => {
    if (rows === null) failed.push(name);
    return rows ?? [];
  };
  const [
    files,
    leads,
    signed,
    invites,
    submissions,
    offers,
    deals,
    ledger,
    events,
    engine,
    access,
    reps,
    funders,
  ] = await Promise.all([
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("pipeline_board")
        .select(
          "id,status,rep_slug,business_name,created_at,updated_at,submitted_at,last_activity_at,documents_pending_review",
        )
        .order("created_at")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb.from("leads").select("created_at,rep_slug").order("created_at").range(a, b),
    ),
    signedTimes(sb),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("application_invites")
        .select(
          "id,rep_slug,sent_at,opened_at,started_at,submitted_at,last_error,created_at,engine_lead_id",
        )
        .order("created_at")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("submissions")
        .select("id,application_id,funder_id,submitted_at")
        .order("id")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("offers")
        .select(
          "id,application_id,funder_id,submission_id,amount,factor_rate,created_at,accepted_at",
        )
        .order("id")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("deals")
        .select(
          "id,application_id,funder_id,rep_slug,funded_on,funded_amount,commission_due,commission_points,status",
        )
        .order("id")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("commission_entries")
        .select("id,deal_id,kind,amount,entry_date")
        .order("id")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("events")
        .select("id,kind,actor_user_id,occurred_at")
        .in("kind", ["call", "sms", "email", "note", "meeting"])
        .order("id")
        .range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb
        .from("engine_leads")
        .select("id,source,tier,rep_slug,first_found,worked_at,phone")
        .order("id")
        .range(a, b),
    ),
    isAdmin
      ? readAll<Record<string, unknown>>((a, b) =>
          sb
            .from("sensitive_access_log")
            .select("id,occurred_at,actor_email,action,application_id")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    readAll<Record<string, unknown>>((a, b) =>
      sb.from("reps").select("slug,name,user_id").order("name").range(a, b),
    ),
    readAll<Record<string, unknown>>((a, b) =>
      sb.from("funders").select("id,name").order("name").range(a, b),
    ),
  ]);
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const data: DashboardData = {
    files: got("files", files).map((r) => ({
      id: String(r["id"]),
      status: String(r["status"]),
      rep_slug: s(r["rep_slug"]),
      business_name: s(r["business_name"]),
      created_at: String(r["created_at"]),
      updated_at: String(r["updated_at"]),
      submitted_at: s(r["submitted_at"]),
      last_activity_at: s(r["last_activity_at"]),
      documents_pending_review: n(r["documents_pending_review"]),
    })),
    leads: got("leads", leads).map((r) => ({
      created_at: String(r["created_at"]),
      rep_slug: s(r["rep_slug"]),
    })),
    signed: got("signatures", signed).map((r) => ({
      application_id: String(r["application_id"]),
      signed_at: s(r["signed_at"]),
    })),
    invites: got("sent links", invites).map((r) => ({
      rep_slug: String(r["rep_slug"]),
      sent_at: s(r["sent_at"]),
      opened_at: s(r["opened_at"]),
      started_at: s(r["started_at"]),
      submitted_at: s(r["submitted_at"]),
      last_error: s(r["last_error"]),
      created_at: String(r["created_at"]),
      engine_lead_id: s(r["engine_lead_id"]),
    })),
    submissions: got("submissions", submissions).map((r) => ({
      id: String(r["id"]),
      application_id: String(r["application_id"]),
      funder_id: String(r["funder_id"]),
      submitted_at: s(r["submitted_at"]),
    })),
    offers: got("offers", offers).map((r) => ({
      application_id: String(r["application_id"]),
      funder_id: String(r["funder_id"]),
      submission_id: s(r["submission_id"]),
      amount: n(r["amount"]),
      factor_rate: nOrNull(r["factor_rate"]),
      created_at: String(r["created_at"]),
      accepted_at: s(r["accepted_at"]),
    })),
    deals: got("deals", deals).map((r) => ({
      id: String(r["id"]),
      application_id: String(r["application_id"]),
      funder_id: String(r["funder_id"]),
      rep_slug: s(r["rep_slug"]),
      funded_on: String(r["funded_on"]),
      funded_amount: n(r["funded_amount"]),
      commission_due: nOrNull(r["commission_due"]),
      commission_points: nOrNull(r["commission_points"]),
      status: String(r["status"]),
    })),
    ledger: got("commission", ledger).map((r) => ({
      deal_id: String(r["deal_id"]),
      kind: r["kind"] as DashboardData["ledger"][number]["kind"],
      amount: n(r["amount"]),
      entry_date: String(r["entry_date"]),
    })),
    events: got("calls and notes", events).map((r) => ({
      kind: String(r["kind"]),
      actor_user_id: s(r["actor_user_id"]),
      occurred_at: String(r["occurred_at"]),
    })),
    engine: got("engine leads", engine).map((r) => ({
      id: String(r["id"]),
      source: String(r["source"] ?? "unknown"),
      tier: s(r["tier"]),
      rep_slug: s(r["rep_slug"]),
      first_found: s(r["first_found"]),
      worked_at: s(r["worked_at"]),
      has_phone: typeof r["phone"] === "string" && r["phone"].trim() !== "",
    })),
    access: got("access log", access).map((r) => ({
      occurred_at: String(r["occurred_at"]),
      actor_email: s(r["actor_email"]),
      action: String(r["action"]),
      application_id: s(r["application_id"]),
    })),
    reps: got("reps", reps).map((r) => ({
      slug: String(r["slug"]),
      name: String(r["name"]),
      user_id: s(r["user_id"]),
    })),
    funders: got("funders", funders).map((r) => ({ id: String(r["id"]), name: String(r["name"]) })),
  };
  let site: SiteEventRow[] = [];
  let activity: ActivityRow[] = [];
  if (isAdmin) {
    // tables newer than the generated types, read untyped
    const db = sb as unknown as SupabaseClient;
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const [s, a] = await Promise.all([
      readAll<SiteEventRow>((x, y) =>
        db
          .from("site_events")
          .select(
            "id,occurred_at,visitor,kind,path,step,question,referrer_host,utm_source,device,country,region,city",
          )
          .gte("occurred_at", since)
          .order("id")
          .range(x, y),
      ),
      readAll<ActivityRow>((x, y) =>
        db
          .from("activity_log")
          .select(
            "id,occurred_at,user_id,email,action,application_id,detail,ip,country,region,city,device,browser",
          )
          .gte("occurred_at", since)
          .order("id")
          .range(x, y),
      ),
    ]);
    site = got("site visits", s);
    activity = got("activity log", a);
  }
  return { data, failed, site, activity };
}

type Loaded = {
  data: DashboardData;
  failed: string[];
  site: SiteEventRow[];
  activity: ActivityRow[];
};

/**
 * The Dashboard tab: Lamp's numbers from the database, for the period picked at the top. Admins
 * see the whole shop; a rep sees their own files, links, leads and deals.
 */
export function Dashboard({ isAdmin, repSlug }: { isAdmin: boolean; repSlug: string | null }) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [raw, setRaw] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load(isAdmin)
      .then((r) => {
        if (!live) return;
        setRaw(r);
        setLoadedAt(new Date());
      })
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : "Couldn't load the numbers."),
      );
    return () => {
      live = false;
    };
  }, [isAdmin, reload]);

  const scope = isAdmin ? null : repSlug;
  const period = useMemo(
    () => periodRange(periodKey, loadedAt ?? new Date()),
    [periodKey, loadedAt],
  );
  const d = useMemo(
    () => (raw ? buildDashboard(raw.data, period, { repSlug: scope }) : null),
    [raw, period, scope],
  );
  const web = useMemo(
    () => (raw && isAdmin ? buildWebsite(raw.site, period) : null),
    [raw, period, isAdmin],
  );
  const act = useMemo(
    () => (raw && isAdmin ? buildActivity(raw.activity, period) : null),
    [raw, period, isAdmin],
  );
  const repName = useMemo(
    () => new Map((raw?.data.reps ?? []).map((r) => [r.slug, r.name])),
    [raw],
  );
  const vs = period.vsLabel;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriodKey(p.key)}
            aria-pressed={periodKey === p.key}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
              periodKey === p.key
                ? "bg-ink text-white"
                : "text-smoke ring-1 ring-line hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setReload((x) => x + 1)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-smoke ring-1 ring-line hover:text-ink"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </button>
      </div>
      <p className="mt-3 text-sm text-smoke">
        {isAdmin ? "Everyone's numbers." : "Your numbers only. Admins see the whole team."}
        {loadedAt &&
          ` Read at ${loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`}
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-white p-4 text-sm ring-1 ring-line">
          {error}
        </p>
      )}
      {raw && raw.failed.length > 0 && (
        <p role="alert" className="mt-6 rounded-xl bg-white p-4 text-sm ring-1 ring-line">
          Some numbers couldn't load ({raw.failed.join(", ")}), so they read as zero. Refresh to try
          again.
        </p>
      )}
      {!d && !error && (
        <Loader2 className="mt-10 size-5 animate-spin text-smoke" aria-label="Loading" />
      )}

      {d && (
        <>
          {/* ---------------- north star ---------------- */}
          <section className="mt-6 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
            <div className={cn(card, "p-5 sm:p-6")}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                North star: merchants funded
              </p>
              <p className="mt-2 font-display text-6xl font-bold tabular-nums tracking-tight">
                {d.northStar.merchants.now}
              </p>
              <Delta c={d.northStar.merchants} vs={vs} />
              <div className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4">
                <Mini label="Funded" c={d.northStar.funded} money />
                <Mini label="Commission expected" c={d.northStar.expected} money />
                <Mini label="Commission received" c={d.northStar.earned} money />
              </div>
            </div>
            <div className={cn(card, "p-5 sm:p-6")}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                Funded per month, last 12 months
              </p>
              <MonthlyBars months={d.monthly} />
            </div>
          </section>

          {/* ---------------- funnel ---------------- */}
          <Section
            title="Start to money"
            note="How many reached each step in this period. Site visits and /apply starts arrive with part 2."
          >
            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div className={cn(card, "p-5")}>
                <Funnel steps={d.funnel} />
              </div>
              <div className={cn(card, "p-5")}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                  How long it takes (median, all files)
                </p>
                <ul className="mt-3 divide-y divide-line">
                  {d.speed.map((s) => (
                    <li key={s.label} className="flex items-baseline justify-between gap-4 py-2.5">
                      <span className="text-sm">{s.label}</span>
                      <span className="text-right">
                        <span className="font-semibold tabular-nums">
                          {s.medianDays === null
                            ? "—"
                            : `${s.medianDays} ${s.medianDays === 1 ? "day" : "days"}`}
                        </span>
                        <span className="block text-xs text-smoke">
                          {s.n} {s.n === 1 ? "file" : "files"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          {/* ---------------- pipeline ---------------- */}
          <Section
            title="Pipeline right now"
            note="Not tied to the period. Click a stage to see its files."
          >
            <div className="grid grid-cols-3 gap-3">
              <Tile label="Open files" value={String(d.pipeline.open)} />
              <Tile label="No rep yet" value={String(d.pipeline.unassigned)} />
              <Tile label="Documents to review" value={String(d.pipeline.docsToReview)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.pipeline.byStage.map((s) => (
                <Link
                  key={s.stage}
                  to="/staff"
                  search={{ stage: s.stage as Stage }}
                  className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm ring-1 ring-line hover:ring-ink/30"
                >
                  {STAGE_LABEL[s.stage as Stage]}
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </Link>
              ))}
            </div>
            <div className={cn(card, "mt-3 overflow-x-auto")}>
              <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                Stuck: no movement in {STUCK_DAYS}+ days
              </p>
              {d.pipeline.stuck.length === 0 ? (
                <p className="px-5 pb-5 pt-2 text-sm text-smoke">
                  Nothing stuck. Every open file moved in the last {STUCK_DAYS} days.
                </p>
              ) : (
                <Table
                  head={["Business", "Stage", "Rep", "Quiet for"]}
                  rows={d.pipeline.stuck.slice(0, 12).map((f) => [
                    <Link
                      key="b"
                      to="/staff"
                      search={{ file: f.id }}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {f.business ?? "Unnamed file"}
                    </Link>,
                    STAGE_LABEL[f.status as Stage] ?? f.status,
                    f.rep_slug ? (repName.get(f.rep_slug) ?? f.rep_slug) : "No rep",
                    `${f.idleDays} days`,
                  ])}
                />
              )}
            </div>
          </Section>

          {/* ---------------- reps ---------------- */}
          <Section title={isAdmin ? "Reps" : "You"} note="In this period.">
            <div className={cn(card, "overflow-x-auto")}>
              <Table
                head={[
                  "Rep",
                  "Links sent",
                  "Opened",
                  "Signed",
                  "Files",
                  "To funders",
                  "Funded",
                  "$ funded",
                  "Commission",
                  "Leads worked",
                  "Calls, notes",
                ]}
                numeric
                rows={d.reps.map((r) => [
                  isAdmin ? (
                    <Link
                      key="r"
                      to="/staff"
                      search={{ rep: r.slug }}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    <span key="r" className="font-semibold">
                      {r.name}
                    </span>
                  ),
                  r.sent,
                  r.opened,
                  r.signed,
                  r.files,
                  r.submitted,
                  r.funded,
                  usd(r.fundedAmount),
                  usd(r.commission),
                  `${r.leadsWorked} of ${r.leadsAssigned}`,
                  r.touches,
                ])}
              />
            </div>
          </Section>

          {/* ---------------- money ---------------- */}
          <Section title="Money" note="Commission to collect counts everything owed, all time.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Funded in this period" value={usd(d.northStar.funded.now)} />
              <Tile label="Commission received" value={usd(d.northStar.earned.now)} />
              <Tile label="Commission to collect" value={usd(d.money.toCollect)} />
              <Tile
                label={`In the ${CLAWBACK_DAYS}-day clawback window`}
                value={String(d.money.clawbackWatch)}
                sub={
                  d.money.clawbackWatch ? `${usd(d.money.clawbackAmount)} of commission` : undefined
                }
              />
            </div>
            <p className="mt-3 text-sm text-smoke">
              Clawback watch and renewal radar, deal by deal, are on the{" "}
              <Link
                to="/staff"
                search={{ view: "money" }}
                className="font-semibold text-forest underline underline-offset-4"
              >
                Money tab
              </Link>
              .
            </p>
          </Section>

          {/* ---------------- funders ---------------- */}
          <Section title="Funders" note="In this period.">
            <div className={cn(card, "overflow-x-auto")}>
              {d.funders.length === 0 ? (
                <p className="p-5 text-sm text-smoke">
                  No files went to funders, and none came back, in this period.
                </p>
              ) : (
                <Table
                  head={[
                    "Funder",
                    "Files sent",
                    "Offers",
                    "Offer rate",
                    "Time to offer",
                    "Avg offer",
                    "Avg factor",
                    "Funded",
                    "$ funded",
                  ]}
                  numeric
                  rows={d.funders.map((f) => [
                    <span key="f" className="font-semibold">
                      {f.name}
                    </span>,
                    f.sent,
                    f.offers,
                    f.offerRate === null ? "—" : `${Math.round(f.offerRate * 100)}%`,
                    f.medianHours === null
                      ? "—"
                      : f.medianHours < 48
                        ? `${f.medianHours} h`
                        : `${Math.round(f.medianHours / 24)} days`,
                    usd(f.avgAmount),
                    f.avgFactor === null ? "—" : f.avgFactor.toFixed(2),
                    f.funded,
                    usd(f.fundedAmount),
                  ])}
                />
              )}
            </div>
          </Section>

          {/* ---------------- lead engine ---------------- */}
          <Section
            title="Lead engine"
            note={isAdmin ? "Every engine lead on file." : "Your engine leads."}
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Leads on file" value={d.engine.total.toLocaleString("en-US")} />
              <Tile label="With a phone" value={d.engine.withPhone.toLocaleString("en-US")} />
              <Tile
                label="New in this period"
                value={d.engine.newInPeriod.toLocaleString("en-US")}
              />
              <Tile
                label="Worked in this period"
                value={d.engine.workedInPeriod.toLocaleString("en-US")}
              />
            </div>
            {d.engine.total > 0 && (
              <>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {d.engine.byTier.map((t) => (
                    <span key={t.tier} className="rounded-full px-3 py-1 ring-1 ring-line">
                      Tier {t.tier}{" "}
                      <span className="font-semibold tabular-nums">
                        {t.count.toLocaleString("en-US")}
                      </span>
                    </span>
                  ))}
                </div>
                <div className={cn(card, "mt-3 overflow-x-auto")}>
                  <Table
                    head={["Source", "Leads", "New in this period", "Applied through a link"]}
                    numeric
                    rows={d.engine.bySource.map((s) => [
                      <span key="s" className="font-semibold">
                        {s.source}
                      </span>,
                      s.total.toLocaleString("en-US"),
                      s.newInPeriod.toLocaleString("en-US"),
                      s.applied,
                    ])}
                  />
                </div>
              </>
            )}
          </Section>

          {/* ---------------- activity and health (admins) ---------------- */}
          {isAdmin && (
            <Section title="Activity and health" note="In this period.">
              <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
                <div className={cn(card, "overflow-x-auto")}>
                  <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                    SSNs shown and application PDFs downloaded ({d.access.total})
                  </p>
                  {d.access.total === 0 ? (
                    <p className="px-5 pb-5 pt-2 text-sm text-smoke">
                      Nobody showed an SSN or downloaded an application PDF.
                    </p>
                  ) : (
                    <Table
                      head={["When", "Who", "What", "File"]}
                      rows={d.access.recent.map((a) => [
                        new Date(a.occurred_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }),
                        a.actor_email ?? "unknown",
                        a.action === "reveal_ssn"
                          ? "Showed an SSN"
                          : a.action === "application_pdf"
                            ? "Downloaded the PDF"
                            : a.action,
                        a.application_id ? (
                          <Link
                            key="f"
                            to="/staff"
                            search={{ file: a.application_id }}
                            className="underline-offset-4 hover:underline"
                          >
                            Open
                          </Link>
                        ) : (
                          "—"
                        ),
                      ])}
                    />
                  )}
                </div>
                <div className="grid gap-3">
                  <Tile
                    label="Application emails that failed to send"
                    value={String(d.health.failedSends)}
                    sub={
                      d.health.failedSends
                        ? "See the Applications tab for the error on each."
                        : "None failed."
                    }
                  />
                </div>
              </div>
            </Section>
          )}

          {/* ---------------- website (admins) ---------------- */}
          {isAdmin && web && (
            <Section
              title="Website"
              note="Lamp's own count: staff browsers and bots left out. In this period."
            >
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DeltaTile label="Page views" c={web.views} vs={vs} />
                <DeltaTile label="Visitors" c={web.visitors} vs={vs} />
                <Tile label="Started /apply" value={String(web.apply[0]?.visitors ?? 0)} />
                <Tile
                  label="Saw their options"
                  value={String(web.apply.find((s) => s.question === "result")?.visitors ?? 0)}
                />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className={cn(card, "overflow-x-auto")}>
                  <Table
                    head={["Where visitors came from", "Visitors"]}
                    numeric
                    rows={
                      web.sources.length
                        ? web.sources.map((s) => [s.key, s.count])
                        : [["No visits yet", ""]]
                    }
                  />
                </div>
                <div className={cn(card, "overflow-x-auto")}>
                  <Table
                    head={["Page", "Views"]}
                    numeric
                    rows={
                      web.pages.length
                        ? web.pages.map((s) => [s.key, s.count])
                        : [["No visits yet", ""]]
                    }
                  />
                </div>
              </div>
              {web.visitors.now > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {web.devices.map((s) => (
                    <span key={s.key} className="rounded-full px-3 py-1 ring-1 ring-line">
                      {s.key.charAt(0).toUpperCase() + s.key.slice(1)}{" "}
                      <span className="font-semibold tabular-nums">
                        {Math.round((s.count / web.visitors.now) * 100)}%
                      </span>
                    </span>
                  ))}
                  {web.places.map((s) => (
                    <span key={s.key} className="rounded-full px-3 py-1 ring-1 ring-line">
                      {s.key} <span className="font-semibold tabular-nums">{s.count}</span>
                    </span>
                  ))}
                </div>
              )}
              {web.apply.length > 0 && (
                <div className={cn(card, "mt-3 p-5")}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                    /apply: how many visitors reached each question
                  </p>
                  <div className="mt-3">
                    <Funnel
                      steps={web.apply.map((s) => ({
                        key: String(s.step),
                        label: questionLabel(s.question),
                        count: s.visitors,
                      }))}
                    />
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ---------------- sign-ins and activity (admins) ---------------- */}
          {isAdmin && act && (
            <Section
              title="Sign-ins and activity"
              note={
                act.flagged
                  ? `${act.flagged} sign-in${act.flagged === 1 ? "" : "s"} from a new place or browser in this period.`
                  : "In this period."
              }
            >
              <div className={cn(card, "overflow-x-auto")}>
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                  Who signed in, from where
                </p>
                {act.signIns.length === 0 ? (
                  <p className="px-5 pb-5 pt-2 text-sm text-smoke">No sign-ins in this period.</p>
                ) : (
                  <Table
                    head={["When", "Who", "Where", "Device", "IP", ""]}
                    rows={act.signIns.map((s) => [
                      when(s.occurred_at),
                      s.email ?? "unknown",
                      placeText(s),
                      s.browser ?? s.device ?? "",
                      s.ip ?? "",
                      s.newPlace || s.newBrowser ? (
                        <span key="n" className="font-semibold text-forest">
                          {s.newPlace ? "New place" : "New browser"}
                        </span>
                      ) : (
                        ""
                      ),
                    ])}
                  />
                )}
              </div>
              <div className="mt-3 grid gap-3">
                <div className={cn(card, "overflow-x-auto")}>
                  <Table
                    head={["Person", "Sign-ins", "Files opened", "Stage changes", "PDFs", "Sends"]}
                    numeric
                    rows={
                      act.byPerson.length
                        ? act.byPerson.map((p) => [
                            p.email,
                            p.counts["sign_in"] ?? 0,
                            p.counts["open_file"] ?? 0,
                            p.counts["change_stage"] ?? 0,
                            p.counts["download_pdf"] ?? 0,
                            (p.counts["send_to_funders"] ?? 0) +
                              (p.counts["send_application"] ?? 0),
                          ])
                        : [["Nobody yet", "", "", "", "", ""]]
                    }
                  />
                </div>
                <div className={cn(card, "overflow-x-auto")}>
                  <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
                    Latest staff actions
                  </p>
                  {act.recent.length === 0 ? (
                    <p className="px-5 pb-5 pt-2 text-sm text-smoke">
                      No staff actions in this period.
                    </p>
                  ) : (
                    <Table
                      head={["When", "Who", "What", "File"]}
                      rows={act.recent.map((r) => [
                        when(r.occurred_at),
                        r.email ?? "unknown",
                        `${ACTIVITY_LABEL[r.action as ActivityAction] ?? r.action}${r.detail ? ` (${r.detail})` : ""}`,
                        r.application_id ? (
                          <Link
                            key="f"
                            to="/staff"
                            search={{ file: r.application_id }}
                            className="underline-offset-4 hover:underline"
                          >
                            Open
                          </Link>
                        ) : (
                          "—"
                        ),
                      ])}
                    />
                  )}
                </div>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The /apply question's own wording, or a plain name for the last two steps. */
function questionLabel(key: string) {
  if (key === "contact") return "Contact details";
  if (key === "result") return "Saw their options";
  const q = QUESTIONS.find((x) => x.key === key);
  return q ? q.title : key;
}

function DeltaTile({ label, c, vs }: { label: string; c: Cmp; vs: string | null }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-smoke">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums">
        {c.now.toLocaleString("en-US")}
      </p>
      <Delta c={c} vs={vs} />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        {note && <p className="text-sm text-smoke">{note}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-smoke">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-smoke">{sub}</p>}
    </div>
  );
}

function Mini({ label, c, money = false }: { label: string; c: Cmp; money?: boolean }) {
  return (
    <div>
      <p className="text-xs text-smoke">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums">
        {money ? usd(c.now) : c.now}
      </p>
      <Delta c={c} money={money} compact />
    </div>
  );
}

/** "+25% vs the same days last month", with an arrow so it never relies on colour. */
function Delta({
  c,
  vs = null,
  money = false,
  compact = false,
}: {
  c: Cmp;
  vs?: string | null;
  money?: boolean;
  compact?: boolean;
}) {
  const text = delta(c, money);
  if (text === null) return null;
  const Icon =
    c.prev === null || c.now === c.prev ? Minus : c.now > c.prev ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("flex items-center gap-1 text-smoke", compact ? "text-xs" : "mt-1 text-sm")}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-semibold text-ink">{text}</span>
      {!compact && vs && <span>{vs}</span>}
      {compact && c.prev !== null && <span>from {money ? usd(c.prev) : c.prev}</span>}
    </p>
  );
}

/** Columns for funded dollars per month. Labels on the best month and this month; the rest on hover. */
function MonthlyBars({
  months,
}: {
  months: { key: string; label: string; year: number; funded: number; deals: number }[];
}) {
  const max = Math.max(...months.map((m) => m.funded), 0);
  const best = max > 0 ? months.findIndex((m) => m.funded === max) : -1;
  const last = months.length - 1;
  return (
    <>
      <div className="mt-4 flex h-44 items-end gap-[2px] border-b border-line" aria-hidden="true">
        {months.map((m, i) => {
          const h = max > 0 ? Math.max((m.funded / max) * 100, m.funded > 0 ? 2 : 0) : 0;
          const label = i === best || (i === last && m.funded > 0);
          return (
            <div
              key={m.key}
              tabIndex={0}
              className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
            >
              {label && (
                <span className="mb-1 text-[0.7rem] font-semibold tabular-nums">
                  {usd(m.funded)}
                </span>
              )}
              <div
                className="w-full max-w-[24px] rounded-t-[4px] bg-leaf"
                style={{ height: `${h}%` }}
              />
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-line group-hover:block group-focus:block">
                <span className="font-semibold">
                  {m.label} {m.year}
                </span>
                : {usd(m.funded)}, {m.deals} {m.deals === 1 ? "deal" : "deals"}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
        {months.map((m) => (
          <span key={m.key} className="flex-1 text-center text-[0.65rem] text-smoke">
            {m.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Funded per month</caption>
        <tbody>
          {months.map((m) => (
            <tr key={m.key}>
              <th scope="row">
                {m.label} {m.year}
              </th>
              <td>{usd(m.funded)}</td>
              <td>{m.deals} deals</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** One bar per step, the count beside it, and the share of the step before. */
function Funnel({ steps }: { steps: { key: string; label: string; count: number }[] }) {
  const max = Math.max(...steps.map((s) => s.count), 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const before = i > 0 ? steps[i - 1]!.count : null;
        return (
          <li
            key={s.key}
            className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[12rem_1fr_auto]"
          >
            <span className="text-sm">{s.label}</span>
            <span className="h-5 rounded-r-[4px]" aria-hidden="true">
              <span
                className="block h-full rounded-r-[4px] bg-leaf"
                style={{ width: s.count ? `${Math.max((s.count / max) * 100, 1.5)}%` : "0%" }}
              />
            </span>
            <span className="w-24 text-right">
              <span className="font-semibold tabular-nums">{s.count}</span>
              {before !== null && before > 0 && s.count <= before && (
                <span className="ml-1.5 text-xs text-smoke">
                  {Math.round((s.count / before) * 100)}%
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Table({
  head,
  rows,
  numeric = false,
}: {
  head: string[];
  rows: ReactNode[][];
  numeric?: boolean;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-smoke">
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cn(
                "px-4 py-3 font-semibold first:pl-5 last:pr-5",
                numeric && i > 0 && "text-right",
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td
                key={ci}
                className={cn(
                  "px-4 py-2.5 first:pl-5 last:pr-5",
                  numeric && ci > 0 && "text-right tabular-nums",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
