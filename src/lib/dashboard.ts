// The staff dashboard's numbers, worked out from rows the portal already reads. No network and no
// database here, so all of it is unit-tested in tests/dashboard.test.ts. Row-level security decides
// which rows arrive (a rep gets their own files and deals); the rep filter here only narrows the
// few tables every staff member can read (leads, engine leads, events).

export type PeriodKey = "7d" | "30d" | "month" | "last_month" | "ytd" | "all";

export const PERIODS: readonly { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

export type Period = {
  from: Date | null;
  to: Date;
  /** The span just before, the same length, for "vs" numbers. Null for all time. */
  prev: { from: Date; to: Date } | null;
  vsLabel: string | null;
};

const DAY = 86_400_000;

export function periodRange(key: PeriodKey, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "7d":
    case "30d": {
      const days = key === "7d" ? 7 : 30;
      const from = new Date(now.getTime() - days * DAY);
      return {
        from,
        to: now,
        prev: { from: new Date(from.getTime() - days * DAY), to: from },
        vsLabel: `vs the ${days} days before`,
      };
    }
    case "month": {
      const from = new Date(y, m, 1);
      const prevFrom = new Date(y, m - 1, 1);
      // same number of days into last month, so a month in progress isn't compared with a full one
      const prevTo = new Date(
        Math.min(prevFrom.getTime() + (now.getTime() - from.getTime()), from.getTime()),
      );
      return {
        from,
        to: now,
        prev: { from: prevFrom, to: prevTo },
        vsLabel: "vs the same days last month",
      };
    }
    case "last_month": {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 1);
      return {
        from,
        to,
        prev: { from: new Date(y, m - 2, 1), to: from },
        vsLabel: "vs the month before",
      };
    }
    case "ytd": {
      const from = new Date(y, 0, 1);
      const prevFrom = new Date(y - 1, 0, 1);
      return {
        from,
        to: now,
        prev: {
          from: prevFrom,
          to: new Date(prevFrom.getTime() + (now.getTime() - from.getTime())),
        },
        vsLabel: "vs the same point last year",
      };
    }
    case "all":
      return { from: null, to: now, prev: null, vsLabel: null };
  }
}

/** Timestamps and plain dates ("2026-10-27", read as local midnight) as epoch milliseconds. */
export function toTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10))
    : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export function within(v: string | null | undefined, from: Date | null, to: Date): boolean {
  const t = toTime(v);
  return t !== null && (from === null || t >= from.getTime()) && t < to.getTime();
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type Cmp = { now: number; prev: number | null };

/** "+25%", "−3", "new" or "same": how this period moved against the one before. */
export function delta(c: Cmp, money = false): string | null {
  if (c.prev === null) return null;
  if (c.now === c.prev) return "same";
  if (c.prev === 0) return "new";
  const pct = Math.round(((c.now - c.prev) / Math.abs(c.prev)) * 100);
  if (!money && Math.abs(c.now - c.prev) < 10) {
    const d = c.now - c.prev;
    return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
  }
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

// ---------- the rows the dashboard reads ----------

export type FileRow = {
  id: string;
  status: string;
  rep_slug: string | null;
  business_name: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  last_activity_at: string | null;
  documents_pending_review: number;
};
export type LeadRow = { created_at: string; rep_slug: string | null };
export type SignedRow = { application_id: string; signed_at: string | null };
export type InviteRow = {
  rep_slug: string;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  last_error: string | null;
  created_at: string;
  engine_lead_id: string | null;
};
export type SubmissionRow = {
  id: string;
  application_id: string;
  funder_id: string;
  submitted_at: string | null;
};
export type OfferRow = {
  application_id: string;
  funder_id: string;
  submission_id: string | null;
  amount: number;
  factor_rate: number | null;
  created_at: string;
  accepted_at: string | null;
};
export type DealRow = {
  id: string;
  application_id: string;
  funder_id: string;
  rep_slug: string | null;
  funded_on: string;
  funded_amount: number;
  commission_due: number | null;
  commission_points: number | null;
  status: string;
};
export type LedgerRow = {
  deal_id: string;
  kind: "owed" | "paid" | "clawback" | "adjustment";
  amount: number;
  entry_date: string;
};
export type EventRow = { kind: string; actor_user_id: string | null; occurred_at: string };
export type EngineRow = {
  id: string;
  source: string;
  tier: string | null;
  rep_slug: string | null;
  first_found: string | null;
  worked_at: string | null;
  has_phone: boolean;
};
export type AccessRow = {
  occurred_at: string;
  actor_email: string | null;
  action: string;
  application_id: string | null;
};
export type RepRef = { slug: string; name: string; user_id: string | null };
export type FunderRef = { id: string; name: string };

export type DashboardData = {
  files: FileRow[];
  leads: LeadRow[];
  signed: SignedRow[];
  invites: InviteRow[];
  submissions: SubmissionRow[];
  offers: OfferRow[];
  deals: DealRow[];
  ledger: LedgerRow[];
  events: EventRow[];
  engine: EngineRow[];
  access: AccessRow[];
  reps: RepRef[];
  funders: FunderRef[];
};

/** Stages a file is still moving through; the rest are finished one way or another. */
export const OPEN_STAGES = [
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
] as const;
export const STUCK_DAYS = 3;
export const CLAWBACK_DAYS = 30;
const TOUCHES = new Set(["call", "sms", "email", "note", "meeting"]);

/** The deal's commission in dollars; deals saved before the amount was worked out fall back to points. */
export const dueOf = (d: {
  funded_amount: number;
  commission_due: number | null;
  commission_points: number | null;
}) =>
  d.commission_due ??
  (d.commission_points === null ? 0 : Math.round(d.funded_amount * d.commission_points) / 100);

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const days = (from: number, to: number) => Math.round(((to - from) / DAY) * 10) / 10;

function firstBy<T>(rows: T[], key: (r: T) => string, time: (r: T) => number | null) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const t = time(r);
    if (t === null) continue;
    const k = key(r);
    const was = out.get(k);
    if (was === undefined || t < was) out.set(k, t);
  }
  return out;
}

export type Dashboard = ReturnType<typeof buildDashboard>;

export function buildDashboard(
  data: DashboardData,
  period: Period,
  opts: { repSlug: string | null; now?: Date },
) {
  const now = opts.now ?? period.to;
  const rep = opts.repSlug;
  const { from, to, prev } = period;
  const inNow = (v: string | null | undefined) => within(v, from, to);
  const inPrev = (v: string | null | undefined) => (prev ? within(v, prev.from, prev.to) : false);
  const cmp = (count: (inside: (v: string | null | undefined) => boolean) => number): Cmp => ({
    now: count(inNow),
    prev: prev ? count(inPrev) : null,
  });

  // the tables any staff member can read, narrowed to a rep's own
  const repUser = rep ? (data.reps.find((r) => r.slug === rep)?.user_id ?? null) : null;
  const leads = rep ? data.leads.filter((l) => l.rep_slug === rep) : data.leads;
  const engine = rep ? data.engine.filter((e) => e.rep_slug === rep) : data.engine;
  const events = rep ? data.events.filter((e) => e.actor_user_id === repUser) : data.events;
  const invites = rep ? data.invites.filter((i) => i.rep_slug === rep) : data.invites;
  const { files, deals, ledger, submissions, offers } = data;

  // ---- north star: merchants funded, with the money beside it ----
  const fundedIn = (inside: (v: string) => boolean) =>
    deals.filter((d) => inside(d.funded_on) && d.status !== "defaulted");
  const northStar = {
    merchants: cmp((inside) => new Set(fundedIn(inside).map((d) => d.application_id)).size),
    funded: cmp((inside) => sum(fundedIn(inside).map((d) => d.funded_amount))),
    expected: cmp((inside) => sum(fundedIn(inside).map((d) => dueOf(d)))),
    earned: cmp((inside) =>
      sum(
        ledger
          .filter((e) => inside(e.entry_date) && (e.kind === "paid" || e.kind === "clawback"))
          .map((e) => (e.kind === "paid" ? e.amount : -e.amount)),
      ),
    ),
  };

  // ---- funded per month, the last 12 months (whatever the period) ----
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const ds = deals.filter((d) => within(d.funded_on, start, end) && d.status !== "defaulted");
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleString("en-US", { month: "short" }),
      year: start.getFullYear(),
      funded: sum(ds.map((d) => d.funded_amount)),
      deals: ds.length,
    };
  });

  // ---- the funnel: how many reached each step during the period ----
  const distinctApps = (rows: { application_id: string }[]) =>
    new Set(rows.map((r) => r.application_id)).size;
  const funnel = [
    {
      key: "email",
      label: "Gave their email",
      count: leads.filter((l) => inNow(l.created_at)).length,
    },
    {
      key: "file",
      label: "Started a file",
      count: files.filter((f) => inNow(f.created_at)).length,
    },
    {
      key: "signed",
      label: "Signed the application",
      count: data.signed.filter((s) => inNow(s.signed_at)).length,
    },
    {
      key: "sent",
      label: "Sent to funders",
      count: distinctApps(submissions.filter((s) => inNow(s.submitted_at))),
    },
    {
      key: "offers",
      label: "Offers back",
      count: distinctApps(offers.filter((o) => inNow(o.created_at))),
    },
    {
      key: "accepted",
      label: "Accepted an offer",
      count: distinctApps(offers.filter((o) => inNow(o.accepted_at))),
    },
    { key: "funded", label: "Funded", count: northStar.merchants.now },
    {
      key: "paid",
      label: "Commission paid",
      count: new Set(
        ledger.filter((e) => e.kind === "paid" && inNow(e.entry_date)).map((e) => e.deal_id),
      ).size,
    },
  ];

  // ---- speed: median days between steps, from every file that made both steps ----
  const fileStart = new Map(files.map((f) => [f.id, toTime(f.created_at)]));
  const firstSent = firstBy(
    submissions,
    (s) => s.application_id,
    (s) => toTime(s.submitted_at),
  );
  const firstOffer = firstBy(
    offers,
    (o) => o.application_id,
    (o) => toTime(o.created_at),
  );
  const funded = firstBy(
    deals,
    (d) => d.application_id,
    (d) => toTime(d.funded_on),
  );
  const gap = (a: Map<string, number | null>, b: Map<string, number>) => {
    const out: number[] = [];
    for (const [id, end] of b) {
      const start = a.get(id);
      if (start !== null && start !== undefined && end >= start) out.push(days(start, end));
    }
    return out;
  };
  const speed = [
    { label: "File started to sent to funders", xs: gap(fileStart, firstSent) },
    { label: "Sent to first offer", xs: gap(firstSent, firstOffer) },
    { label: "First offer to funded", xs: gap(firstOffer, funded) },
    { label: "File started to funded", xs: gap(fileStart, funded) },
  ].map((s) => ({ label: s.label, medianDays: median(s.xs), n: s.xs.length }));

  // ---- pipeline right now ----
  const open = files.filter((f) => (OPEN_STAGES as readonly string[]).includes(f.status));
  const byStage = OPEN_STAGES.map((stage) => ({
    stage,
    count: open.filter((f) => f.status === stage).length,
  }));
  const stuck = open
    .map((f) => {
      const last = toTime(f.last_activity_at) ?? toTime(f.updated_at) ?? toTime(f.created_at)!;
      return {
        id: f.id,
        business: f.business_name,
        status: f.status,
        rep_slug: f.rep_slug,
        idleDays: Math.floor((now.getTime() - last) / DAY),
      };
    })
    .filter((f) => f.idleDays >= STUCK_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays);
  const pipeline = {
    open: open.length,
    byStage,
    unassigned: open.filter((f) => !f.rep_slug).length,
    docsToReview: sum(open.map((f) => f.documents_pending_review)),
    stuck,
  };

  // ---- reps ----
  const repRows = (rep ? data.reps.filter((r) => r.slug === rep) : data.reps).map((r) => {
    const mine = invites.filter((i) => i.rep_slug === r.slug);
    const myDeals = deals.filter((d) => d.rep_slug === r.slug && inNow(d.funded_on));
    const myFiles = files.filter((f) => f.rep_slug === r.slug);
    return {
      slug: r.slug,
      name: r.name,
      sent: mine.filter((i) => inNow(i.sent_at)).length,
      opened: mine.filter((i) => inNow(i.opened_at)).length,
      started: mine.filter((i) => inNow(i.started_at)).length,
      signed: mine.filter((i) => inNow(i.submitted_at)).length,
      files: myFiles.filter((f) => inNow(f.created_at)).length,
      submitted: myFiles.filter((f) => inNow(f.submitted_at)).length,
      funded: myDeals.length,
      fundedAmount: sum(myDeals.map((d) => d.funded_amount)),
      commission: sum(myDeals.map((d) => dueOf(d))),
      leadsAssigned: engine.filter((e) => e.rep_slug === r.slug).length,
      leadsWorked: engine.filter((e) => e.rep_slug === r.slug && inNow(e.worked_at)).length,
      touches: r.user_id
        ? events.filter(
            (e) => e.actor_user_id === r.user_id && TOUCHES.has(e.kind) && inNow(e.occurred_at),
          ).length
        : 0,
    };
  });

  // ---- funders ----
  const subById = new Map(submissions.map((s) => [s.id, s]));
  const funderRows = data.funders
    .map((f) => {
      const sent = submissions.filter((s) => s.funder_id === f.id && inNow(s.submitted_at));
      const got = offers.filter((o) => o.funder_id === f.id && inNow(o.created_at));
      const hours = got.flatMap((o) => {
        const s = o.submission_id
          ? subById.get(o.submission_id)
          : submissions.find((x) => x.application_id === o.application_id && x.funder_id === f.id);
        const a = toTime(s?.submitted_at);
        const b = toTime(o.created_at);
        return a !== null && b !== null && b >= a ? [Math.round((b - a) / 3_600_000)] : [];
      });
      const factors = got.flatMap((o) => (o.factor_rate ? [o.factor_rate] : []));
      const fundedHere = deals.filter((d) => d.funder_id === f.id && inNow(d.funded_on));
      const sentApps = distinctApps(sent);
      return {
        id: f.id,
        name: f.name,
        sent: sentApps,
        offers: distinctApps(got),
        offerRate: sentApps ? Math.min(1, distinctApps(got) / sentApps) : null,
        medianHours: median(hours),
        avgAmount: got.length ? Math.round(sum(got.map((o) => o.amount)) / got.length) : null,
        avgFactor: factors.length ? Math.round((sum(factors) / factors.length) * 100) / 100 : null,
        funded: fundedHere.length,
        fundedAmount: sum(fundedHere.map((d) => d.funded_amount)),
      };
    })
    .filter((f) => f.sent || f.offers || f.funded)
    .sort((a, b) => b.fundedAmount - a.fundedAmount || b.sent - a.sent);

  // ---- lead engine ----
  const sources = [...new Set(engine.map((e) => e.source))].sort();
  const appliedLead = new Set(
    invites.filter((i) => i.submitted_at && i.engine_lead_id).map((i) => i.engine_lead_id),
  );
  const engineBlock = {
    total: engine.length,
    withPhone: engine.filter((e) => e.has_phone).length,
    newInPeriod: engine.filter((e) => inNow(e.first_found)).length,
    workedInPeriod: engine.filter((e) => inNow(e.worked_at)).length,
    byTier: [...new Set(engine.map((e) => e.tier ?? "none"))]
      .sort()
      .map((tier) => ({ tier, count: engine.filter((e) => (e.tier ?? "none") === tier).length })),
    bySource: sources
      .map((source) => {
        const rows = engine.filter((e) => e.source === source);
        return {
          source,
          total: rows.length,
          newInPeriod: rows.filter((e) => inNow(e.first_found)).length,
          applied: rows.filter((e) => appliedLead.has(e.id)).length,
        };
      })
      .sort((a, b) => b.total - a.total),
  };

  // ---- money ----
  const watch = deals.filter(
    (d) =>
      d.status === "funded" && (now.getTime() - (toTime(d.funded_on) ?? 0)) / DAY < CLAWBACK_DAYS,
  );
  const ledgerAll = { owed: 0, paid: 0, clawback: 0, adjustment: 0 };
  for (const e of ledger) ledgerAll[e.kind] += e.amount;
  const money = {
    clawbackWatch: watch.length,
    clawbackAmount: sum(watch.map((d) => dueOf(d))),
    owedAllTime: sum([ledgerAll.owed, ledgerAll.adjustment]),
    toCollect: sum([ledgerAll.owed, ledgerAll.adjustment, -ledgerAll.paid, -ledgerAll.clawback]),
  };

  // ---- activity and health ----
  const access = data.access
    .filter((a) => inNow(a.occurred_at))
    .sort((a, b) => (toTime(b.occurred_at) ?? 0) - (toTime(a.occurred_at) ?? 0));
  const health = {
    failedSends: invites.filter((i) => i.last_error && !i.sent_at && inNow(i.created_at)).length,
  };

  return {
    northStar,
    monthly,
    funnel,
    speed,
    pipeline,
    reps: repRows,
    funders: funderRows,
    engine: engineBlock,
    money,
    access: { total: access.length, recent: access.slice(0, 10) },
    health,
  };
}
