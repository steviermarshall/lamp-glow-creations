import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary, card } from "@/components/site/layout";
import {
  CLAWBACK_DAYS,
  DEAL_STATUS_LABEL,
  LEDGER_KIND_LABEL,
  RENEWAL_AT,
  RENEWAL_WATCH_FROM,
  daysSince,
  ledgerTotals,
  paidDown,
  parseMoney,
  usd,
  type DealStatus,
  type Frequency,
  type LedgerKind,
} from "@/lib/money";
import { Field } from "@/components/staff/fields";
import { chip, input } from "@/components/staff/field-styles";

/**
 * Money: every funded deal, what Lamp is owed and has been paid on it, the deals still inside the
 * clawback window, and the renewals coming due. Admins see every deal and the ledger; a rep sees
 * only deals carrying their slug (the database's "Reps read own deals") and no ledger.
 *
 * Paid-down figures are estimates from each offer's payment schedule, not bank data.
 */

type Deal = {
  id: string;
  application_id: string;
  offer_id: string;
  funder_id: string;
  rep_slug: string | null;
  funded_on: string;
  funded_amount: number;
  payback: number;
  commission_points: number | null;
  commission_due: number | null;
  status: DealStatus;
  notes: string | null;
};
type Entry = {
  id: string;
  deal_id: string;
  kind: LedgerKind;
  amount: number;
  entry_date: string;
  counterparty: string | null;
  reference: string | null;
  note: string | null;
};

const STATUSES: DealStatus[] = ["funded", "paid_off", "renewed", "defaulted"];
const KINDS: LedgerKind[] = ["paid", "clawback", "adjustment", "owed"];

export function Money({
  isAdmin,
  userId,
  reps,
}: {
  isAdmin: boolean;
  userId: string;
  reps: { slug: string; name: string }[];
}) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [schedule, setSchedule] = useState<Map<string, { frequency: Frequency; payments: number }>>(
    new Map(),
  );
  const [names, setNames] = useState<{ biz: Map<string, string>; funder: Map<string, string> }>({
    biz: new Map(),
    funder: new Map(),
  });
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const d = await sb
        .from("deals")
        .select(
          "id,application_id,offer_id,funder_id,rep_slug,funded_on,funded_amount,payback,commission_points,commission_due,status,notes",
        )
        .order("funded_on", { ascending: false });
      if (!live) return;
      if (d.error) {
        setError("Couldn't load deals. Refresh to try again.");
        setDeals([]);
        return;
      }
      const rows = (d.data as Deal[]).map((x) => ({
        ...x,
        funded_amount: +x.funded_amount,
        payback: +x.payback,
        commission_due: x.commission_due === null ? null : +x.commission_due,
      }));
      const ids = rows.map((r) => r.id);
      const [l, o, a, f] = await Promise.all([
        isAdmin && ids.length
          ? sb
              .from("commission_entries")
              .select("id,deal_id,kind,amount,entry_date,counterparty,reference,note")
              .in("deal_id", ids)
              .order("entry_date")
          : Promise.resolve({ data: [], error: null }),
        ids.length
          ? sb
              .from("offers")
              .select("id,frequency,payments")
              .in(
                "id",
                rows.map((r) => r.offer_id),
              )
          : Promise.resolve({ data: [], error: null }),
        ids.length
          ? sb
              .from("applications")
              .select("id,business_name")
              .in(
                "id",
                rows.map((r) => r.application_id),
              )
          : Promise.resolve({ data: [], error: null }),
        sb.from("funders").select("id,name"),
      ]);
      if (!live) return;
      setEntries(((l.data as Entry[] | null) ?? []).map((e) => ({ ...e, amount: +e.amount })));
      setSchedule(
        new Map(
          ((o.data as { id: string; frequency: Frequency; payments: number }[] | null) ?? []).map(
            (x) => [x.id, { frequency: x.frequency, payments: x.payments }],
          ),
        ),
      );
      setNames({
        biz: new Map(
          ((a.data as { id: string; business_name: string | null }[] | null) ?? []).map((x) => [
            x.id,
            x.business_name ?? "Unnamed business",
          ]),
        ),
        funder: new Map(
          ((f.data as { id: string; name: string }[] | null) ?? []).map((x) => [x.id, x.name]),
        ),
      });
      setDeals(rows);
    })();
    return () => {
      live = false;
    };
  }, [isAdmin, reload]);

  const byDeal = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) m.set(e.deal_id, [...(m.get(e.deal_id) ?? []), e]);
    return m;
  }, [entries]);

  if (deals === null) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-smoke" />
      </div>
    );
  }

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "No rep";
  const biz = (d: Deal) => names.biz.get(d.application_id) ?? "Business";
  const funder = (d: Deal) => names.funder.get(d.funder_id) ?? "Funder";
  const progress = (d: Deal) => {
    const s = schedule.get(d.offer_id);
    return s ? paidDown(d.funded_on, s.frequency, s.payments) : null;
  };

  const all = ledgerTotals(entries);
  const month = new Date().toISOString().slice(0, 7);
  const fundedThisMonth = deals.filter((d) => d.funded_on.startsWith(month));
  const clawback = deals.filter(
    (d) => d.status === "funded" && daysSince(d.funded_on) <= CLAWBACK_DAYS,
  );
  const renewals = deals
    .filter((d) => d.status === "funded")
    .map((d) => ({ d, p: progress(d) }))
    .filter((x) => x.p && x.p.share >= RENEWAL_WATCH_FROM)
    .sort((a, b) => (b.p?.share ?? 0) - (a.p?.share ?? 0));

  async function setStatus(d: Deal, status: DealStatus) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(d.id);
    setError("");
    const { error: e } = await sb.from("deals").update({ status }).eq("id", d.id);
    setBusy(null);
    if (e) setError("Couldn't change the deal. Only admins can.");
    else setReload((n) => n + 1);
  }

  return (
    <div className="mt-6 space-y-5">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Funded this month"
          value={usd(fundedThisMonth.reduce((s, d) => s + d.funded_amount, 0))}
          sub={`${fundedThisMonth.length} deals`}
        />
        <Stat
          label="Deals on the books"
          value={String(deals.length)}
          sub={`${deals.filter((d) => d.status === "funded").length} still paying`}
        />
        {isAdmin && (
          <Stat label="Commission received" value={usd(all.earned)} sub="after clawbacks" />
        )}
        {isAdmin && (
          <Stat label="Still to collect" value={usd(all.outstanding)} sub="owed minus received" />
        )}
      </div>

      <section className={cn(card, "p-6")} data-clawback-watch>
        <h3 className="font-display text-lg font-semibold">Clawback watch</h3>
        <p className="mt-1 text-sm text-smoke">
          Deals funded in the last {CLAWBACK_DAYS} days. If the merchant defaults this early, the
          funder can take the commission back, so call these merchants and watch for bounced
          payments.
        </p>
        {clawback.length === 0 ? (
          <p className="mt-3 text-sm text-smoke">Nothing inside the window.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {clawback.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-3 rounded-xl bg-sand px-4 py-2.5">
                <Link
                  to="/staff"
                  search={{ file: d.application_id }}
                  className="font-semibold underline"
                >
                  {biz(d)}
                </Link>
                <span className="text-smoke">
                  day {daysSince(d.funded_on)} of {CLAWBACK_DAYS} · {funder(d)} ·{" "}
                  {usd(d.funded_amount)}
                </span>
                {d.commission_due !== null && (
                  <span className="ml-auto">commission at stake {usd(d.commission_due)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(card, "p-6")} data-renewal-radar>
        <h3 className="font-display text-lg font-semibold">Renewal radar</h3>
        <p className="mt-1 text-sm text-smoke">
          Funded deals about {Math.round(RENEWAL_WATCH_FROM * 100)}% or more paid down, by their
          payment schedule. From about {Math.round(RENEWAL_AT * 100)}% the merchant can usually
          renew. Call before the funder does.
        </p>
        {renewals.length === 0 ? (
          <p className="mt-3 text-sm text-smoke">No deal is close to renewal yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {renewals.map(({ d, p }) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 rounded-xl bg-sand px-4 py-2.5"
              >
                <Link
                  to="/staff"
                  search={{ file: d.application_id }}
                  className="font-semibold underline"
                >
                  {biz(d)}
                </Link>
                <span className="text-smoke">
                  about {Math.round((p?.share ?? 0) * 100)}% paid · {funder(d)} ·{" "}
                  {repName(d.rep_slug)}
                </span>
                {(p?.share ?? 0) >= RENEWAL_AT && (
                  <span className="ml-auto font-semibold text-forest">Call now</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(card, "p-6")} data-deals>
        <h3 className="font-display text-lg font-semibold">Deals</h3>
        {deals.length === 0 ? (
          <p className="mt-3 text-sm text-smoke">
            No funded deals yet. A deal appears here when an admin clicks Mark funded on a file.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {deals.map((d) => {
              const t = ledgerTotals(byDeal.get(d.id) ?? []);
              const p = progress(d);
              return (
                <li key={d.id} className="rounded-xl border border-line p-4 text-sm" data-deal-row>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      to="/staff"
                      search={{ file: d.application_id }}
                      className="font-semibold underline"
                    >
                      {biz(d)}
                    </Link>
                    <span className="font-display text-base font-semibold">
                      {usd(d.funded_amount)}
                    </span>
                    <span className="text-smoke">
                      {funder(d)} · {repName(d.rep_slug)} · funded {d.funded_on}
                      {p && ` · about ${Math.round(p.share * 100)}% paid`}
                    </span>
                    {isAdmin ? (
                      <select
                        aria-label="Deal status"
                        className="ml-auto rounded-full bg-white px-3 py-1 text-xs ring-1 ring-line"
                        value={d.status}
                        disabled={busy === d.id}
                        onChange={(e) => setStatus(d, e.target.value as DealStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {DEAL_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="ml-auto text-smoke">{DEAL_STATUS_LABEL[d.status]}</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-smoke">
                      <span>Owed {usd(t.owed + t.adjustment)}</span>
                      <span>Received {usd(t.paid)}</span>
                      {t.clawback > 0 && (
                        <span className="text-destructive">Clawed back {usd(t.clawback)}</span>
                      )}
                      <span className="font-semibold text-ink">
                        Still to collect {usd(t.outstanding)}
                      </span>
                      <button
                        type="button"
                        className={cn(chip, "ml-auto")}
                        onClick={() => setOpen(open === d.id ? null : d.id)}
                      >
                        {open === d.id ? "Hide ledger" : "Ledger"}
                      </button>
                    </div>
                  )}
                  {isAdmin && open === d.id && (
                    <Ledger
                      deal={d}
                      entries={byDeal.get(d.id) ?? []}
                      counterparty={funder(d)}
                      userId={userId}
                      onSaved={() => setReload((n) => n + 1)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className="text-xs font-semibold text-smoke">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-smoke">{sub}</p>
    </div>
  );
}

function Ledger({
  deal,
  entries,
  counterparty,
  userId,
  onSaved,
}: {
  deal: Deal;
  entries: Entry[];
  counterparty: string;
  userId: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<LedgerKind>("paid");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    const sb = getSupabase();
    const amt = parseMoney(amount);
    if (!sb) return;
    if (amt === null || (kind !== "adjustment" && amt <= 0)) {
      setError(
        kind === "adjustment"
          ? "Enter an amount (negative to reduce)."
          : "Enter an amount above zero.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const { error: e } = await sb.from("commission_entries").insert({
      deal_id: deal.id,
      kind,
      amount: amt,
      entry_date: date,
      counterparty,
      reference: reference.trim() || null,
      note: note.trim() || null,
      created_by: userId,
    });
    setBusy(false);
    if (e) {
      setError("Couldn't save. Only admins can write the ledger.");
      return;
    }
    setAmount("");
    setReference("");
    setNote("");
    onSaved();
  }

  return (
    <div className="mt-3 rounded-xl bg-sand p-4" data-ledger>
      {entries.length === 0 ? (
        <p className="text-smoke">No entries yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs text-smoke">
            <tr>
              <th className="py-1 font-semibold">Date</th>
              <th className="py-1 font-semibold">Entry</th>
              <th className="py-1 text-right font-semibold">Amount</th>
              <th className="py-1 pl-4 font-semibold">Reference</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line/60">
                <td className="py-1.5">{e.entry_date}</td>
                <td className="py-1.5">{LEDGER_KIND_LABEL[e.kind]}</td>
                <td className="py-1.5 text-right tabular-nums">{usd(e.amount)}</td>
                <td className="py-1.5 pl-4 text-smoke">
                  {[e.reference, e.note].filter(Boolean).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <Field label="Entry">
          <select
            className={input}
            value={kind}
            onChange={(e) => setKind(e.target.value as LedgerKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {LEDGER_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            className={input}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <input
            className={input}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Reference">
          <input
            className={input}
            placeholder="check #, ACH id"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field label="Note">
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <button
        type="button"
        className={cn(btnPrimary, "mt-3 px-5 py-2")}
        disabled={busy}
        onClick={add}
      >
        {busy ? "Saving…" : "Add to ledger"}
      </button>
    </div>
  );
}
