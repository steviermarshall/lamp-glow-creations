import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { btnPrimary, card } from "@/components/site/layout";
import {
  FREQUENCIES,
  FREQUENCY_LABEL,
  OFFER_STATUS_LABEL,
  SUBMISSION_STATUS_LABEL,
  commissionDue,
  offerMath,
  parseMoney,
  usd,
  type Frequency,
  type OfferStatus,
  type SubmissionStatus,
} from "@/lib/money";
import { Field } from "@/components/staff/fields";
import { chip, chipDark, input, textarea } from "@/components/staff/field-styles";

/**
 * Funders and offers on one file: which funders it went to, what each came back with, which
 * offer the merchant sees and takes, and (admins) the funded deal with its commission.
 *
 * The database does the bookkeeping: a submission stamps the file as sent, an offer starts
 * "received" (hidden from the merchant) until a person presents it, accept_offer() declines the
 * other presented offers and moves the file to accepted, and a deal row moves it to funded and
 * shows the merchant a "funded" event. This screen only writes rows the policies allow.
 */

type Funder = { id: string; name: string; commission_points: number | null; active: boolean };
type Submission = {
  id: string;
  funder_id: string;
  status: SubmissionStatus;
  decline_reason: string | null;
  notes: string | null;
  submitted_at: string;
  decided_at: string | null;
};
type Offer = {
  id: string;
  funder_id: string;
  submission_id: string | null;
  amount: number;
  payback: number;
  fees: number;
  frequency: Frequency;
  payments: number;
  status: OfferStatus;
  presented_at: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
};
type Deal = {
  id: string;
  offer_id: string;
  funded_on: string;
  funded_amount: number;
  commission_due: number | null;
  status: string;
};

const SUB_STATUSES: SubmissionStatus[] = ["submitted", "offer", "declined", "withdrawn", "expired"];
const today = () => new Date().toISOString().slice(0, 10);

export function FileOffers({
  fileId,
  userId,
  isAdmin,
  fileRep,
  onChange,
}: {
  fileId: string;
  userId: string;
  isAdmin: boolean;
  fileRep: string | null;
  onChange: () => void;
}) {
  const [funders, setFunders] = useState<Funder[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<"send" | "offer" | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [f, s, o, d] = await Promise.all([
      sb.from("funders").select("id,name,commission_points,active").order("name"),
      sb
        .from("submissions")
        .select("id,funder_id,status,decline_reason,notes,submitted_at,decided_at")
        .eq("application_id", fileId)
        .order("submitted_at"),
      sb
        .from("offers")
        .select(
          "id,funder_id,submission_id,amount,payback,fees,frequency,payments,status,presented_at,accepted_at,expires_at,notes,created_at",
        )
        .eq("application_id", fileId)
        .order("created_at"),
      sb
        .from("deals")
        .select("id,offer_id,funded_on,funded_amount,commission_due,status")
        .eq("application_id", fileId)
        .maybeSingle(),
    ]);
    if (f.error || s.error || o.error)
      setError("Couldn't load funders and offers. Refresh to try again.");
    setFunders((f.data as Funder[] | null) ?? []);
    setSubs((s.data as Submission[] | null) ?? []);
    setOffers(
      ((o.data as Offer[] | null) ?? []).map((x) => ({
        ...x,
        amount: +x.amount,
        payback: +x.payback,
        fees: +x.fees,
      })),
    );
    setDeal((d.data as Deal | null) ?? null);
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = useMemo(() => {
    const m = new Map(funders.map((f) => [f.id, f.name]));
    return (id: string) => m.get(id) ?? "Unknown funder";
  }, [funders]);

  async function run(
    key: string,
    fn: () => Promise<{ error: { message: string } | null }>,
    fail: string,
  ) {
    setBusy(key);
    setError("");
    const { error: e } = await fn();
    setBusy(null);
    if (e) {
      setError(
        `${fail} ${/permission|policy|privilege|not your/i.test(e.message) ? "You don't have access to do that." : e.message}`,
      );
      return false;
    }
    await load();
    onChange();
    return true;
  }

  const sb = getSupabase();
  if (!sb) return null;

  const sentTo = new Set(subs.map((s) => s.funder_id));
  const open = funders.filter((f) => f.active && !sentTo.has(f.id));
  const accepted = offers.find((o) => o.status === "accepted") ?? null;

  return (
    <section className={cn(card, "p-6")} data-file-offers>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold">Funders and offers</h3>
        {!deal && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className={chip}
              onClick={() => setPanel(panel === "send" ? null : "send")}
            >
              Send to a funder
            </button>
            <button
              type="button"
              className={chip}
              onClick={() => setPanel(panel === "offer" ? null : "offer")}
            >
              Add an offer
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {panel === "send" && (
        <SendForm
          funders={open}
          busy={busy === "send"}
          onCancel={() => setPanel(null)}
          onSend={async (funderId, notes) => {
            const ok = await run(
              "send",
              async () =>
                sb.from("submissions").insert({
                  application_id: fileId,
                  funder_id: funderId,
                  submitted_by: userId,
                  notes: notes || null,
                }),
              "Couldn't record the submission.",
            );
            if (ok) setPanel(null);
          }}
        />
      )}

      {panel === "offer" && (
        <OfferForm
          funders={funders.filter((f) => f.active || sentTo.has(f.id))}
          preferred={subs
            .filter((s) => s.status === "submitted" || s.status === "offer")
            .map((s) => s.funder_id)}
          busy={busy === "offer"}
          onCancel={() => setPanel(null)}
          onSave={async (o) => {
            const sub = subs.find((s) => s.funder_id === o.funder_id) ?? null;
            const ok = await run(
              "offer",
              async () => {
                const r = await sb.from("offers").insert({
                  application_id: fileId,
                  funder_id: o.funder_id,
                  submission_id: sub?.id ?? null,
                  amount: o.amount,
                  payback: o.payback,
                  fees: o.fees,
                  frequency: o.frequency,
                  payments: o.payments,
                  expires_at: o.expires ? `${o.expires}T23:59:59` : null,
                  notes: o.notes || null,
                  created_by: userId,
                });
                if (!r.error && sub && sub.status === "submitted") {
                  await sb
                    .from("submissions")
                    .update({ status: "offer", decided_at: new Date().toISOString() })
                    .eq("id", sub.id);
                }
                return r;
              },
              "Couldn't save the offer.",
            );
            if (ok) setPanel(null);
          }}
        />
      )}

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-smoke">Sent to</h4>
      {subs.length === 0 ? (
        <p className="mt-2 text-sm text-smoke">Not sent to any funder yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {subs.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-sand px-4 py-3 text-sm"
            >
              <span className="font-semibold">{name(s.funder_id)}</span>
              <span className="text-smoke">sent {stamp(s.submitted_at)}</span>
              {s.decline_reason && <span className="text-smoke">· {s.decline_reason}</span>}
              <select
                aria-label={`Status with ${name(s.funder_id)}`}
                className="ml-auto rounded-full bg-white px-3 py-1 text-xs ring-1 ring-line"
                value={s.status}
                disabled={busy === s.id}
                onChange={async (e) => {
                  const status = e.target.value as SubmissionStatus;
                  const reason =
                    status === "declined"
                      ? (window.prompt("Why did they decline? (optional)") ?? "").trim()
                      : "";
                  await run(
                    s.id,
                    async () =>
                      sb
                        .from("submissions")
                        .update({
                          status,
                          decline_reason: status === "declined" ? reason || null : s.decline_reason,
                          decided_at: status === "submitted" ? null : new Date().toISOString(),
                        })
                        .eq("id", s.id),
                    "Couldn't update the submission.",
                  );
                }}
              >
                {SUB_STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {SUBMISSION_STATUS_LABEL[v]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-smoke">Offers</h4>
      {offers.length === 0 ? (
        <p className="mt-2 text-sm text-smoke">No offers yet.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {offers.map((o) => {
            const m = offerMath(o);
            const expired = o.expires_at !== null && new Date(o.expires_at) < new Date();
            return (
              <li
                key={o.id}
                className="rounded-xl bg-sand px-4 py-3 text-sm"
                data-offer-status={o.status}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{name(o.funder_id)}</span>
                  <span className="font-display text-base font-semibold">{usd(o.amount)}</span>
                  <span className="text-smoke">{OFFER_STATUS_LABEL[o.status]}</span>
                  {expired && o.status === "presented" && (
                    <span className="text-destructive">past its expiry</span>
                  )}
                </div>
                <p className="mt-1 text-smoke">
                  Pays back {usd(o.payback)} ({m.factor.toFixed(2)} factor) in {o.payments}{" "}
                  {FREQUENCY_LABEL[o.frequency].toLowerCase()} payments of{" "}
                  {usd(Math.round(m.payment * 100) / 100)}.
                  {o.fees > 0 && ` Fees ${usd(o.fees)}, so ${usd(m.net)} lands in the account.`}{" "}
                  Total cost {usd(m.cost)}.{o.expires_at && ` Good until ${stamp(o.expires_at)}.`}
                </p>
                {o.notes && <p className="mt-1">{o.notes}</p>}
                {!deal && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.status === "received" && (
                      <button
                        type="button"
                        className={chipDark}
                        disabled={busy === o.id}
                        onClick={() =>
                          run(
                            o.id,
                            async () =>
                              sb.from("offers").update({ status: "presented" }).eq("id", o.id),
                            "Couldn't present the offer.",
                          )
                        }
                      >
                        Show to merchant
                      </button>
                    )}
                    {o.status === "presented" && isAdmin && (
                      <button
                        type="button"
                        className={chipDark}
                        disabled={busy === o.id || expired}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Mark this offer accepted? Any other presented offers on this file are declined.",
                            )
                          )
                            return;
                          void run(
                            o.id,
                            async () => sb.rpc("accept_offer", { _offer_id: o.id }),
                            "Couldn't accept the offer.",
                          );
                        }}
                      >
                        Merchant accepted
                      </button>
                    )}
                    {(o.status === "received" || o.status === "presented") && (
                      <button
                        type="button"
                        className={chip}
                        disabled={busy === o.id}
                        onClick={() =>
                          run(
                            o.id,
                            async () =>
                              sb.from("offers").update({ status: "withdrawn" }).eq("id", o.id),
                            "Couldn't withdraw the offer.",
                          )
                        }
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deal ? (
        <p className="mt-5 rounded-xl bg-sand px-4 py-3 text-sm" data-deal>
          <span className="font-semibold">Funded {usd(+deal.funded_amount)}</span> on{" "}
          {deal.funded_on}
          {deal.commission_due !== null && ` · commission ${usd(+deal.commission_due)}`}. The ledger
          is on the Money view.
        </p>
      ) : (
        accepted &&
        isAdmin && (
          <FundForm
            offer={accepted}
            points={funders.find((f) => f.id === accepted.funder_id)?.commission_points ?? null}
            busy={busy === "fund"}
            onFund={async (v) => {
              await run(
                "fund",
                async () => {
                  const due = commissionDue(v.amount, v.points);
                  const r = await sb
                    .from("deals")
                    .insert({
                      application_id: fileId,
                      offer_id: accepted.id,
                      funder_id: accepted.funder_id,
                      rep_slug: fileRep,
                      funded_on: v.date,
                      funded_amount: v.amount,
                      payback: Math.max(accepted.payback, v.amount),
                      commission_points: v.points,
                      commission_due: due,
                    })
                    .select("id")
                    .single();
                  if (r.error || !r.data)
                    return { error: r.error ?? { message: "no deal returned" } };
                  if (due && due > 0) {
                    const l = await sb.from("commission_entries").insert({
                      deal_id: r.data.id,
                      kind: "owed",
                      amount: due,
                      entry_date: v.date,
                      counterparty: name(accepted.funder_id),
                      note: `${v.points} points on ${usd(v.amount)}`,
                      created_by: userId,
                    });
                    if (l.error)
                      return {
                        error: {
                          message: `Deal saved, but the commission entry failed: ${l.error.message}`,
                        },
                      };
                  }
                  return { error: null };
                },
                "Couldn't record the funding.",
              );
            }}
          />
        )
      )}
    </section>
  );
}

function SendForm({
  funders,
  busy,
  onSend,
  onCancel,
}: {
  funders: Funder[];
  busy: boolean;
  onSend: (funderId: string, notes: string) => void;
  onCancel: () => void;
}) {
  const [funderId, setFunderId] = useState("");
  const [notes, setNotes] = useState("");
  if (funders.length === 0) {
    return (
      <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm text-smoke">
        No funder left to send to. Add funders on the Funders view.
      </p>
    );
  }
  return (
    <div className="mt-4 grid gap-3 rounded-xl bg-sand p-4 sm:grid-cols-2">
      <Field label="Funder">
        <select className={input} value={funderId} onChange={(e) => setFunderId(e.target.value)}>
          <option value="">Pick a funder</option>
          {funders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note (optional)">
        <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="text-xs text-smoke sm:col-span-2">
        This records that the file went out; it doesn't email anyone. Sending locks the merchant's
        documents so what the funder saw stays with the file.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="button"
          className={cn(btnPrimary, "px-5 py-2")}
          disabled={!funderId || busy}
          onClick={() => onSend(funderId, notes.trim())}
        >
          {busy ? "Saving…" : "Record as sent"}
        </button>
        <button type="button" className={chip} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type OfferInput = {
  funder_id: string;
  amount: number;
  payback: number;
  fees: number;
  frequency: Frequency;
  payments: number;
  expires: string;
  notes: string;
};

function OfferForm({
  funders,
  preferred,
  busy,
  onSave,
  onCancel,
}: {
  funders: Funder[];
  preferred: string[];
  busy: boolean;
  onSave: (o: OfferInput) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    funder_id: preferred[0] ?? "",
    amount: "",
    payback: "",
    fees: "",
    frequency: "daily" as Frequency,
    payments: "",
    expires: "",
    notes: "",
  });
  const [problem, setProblem] = useState("");
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const amount = parseMoney(f.amount);
  const payback = parseMoney(f.payback);
  const fees = parseMoney(f.fees) ?? 0;
  const payments = Number(f.payments);
  const ready = amount !== null && payback !== null && Number.isInteger(payments) && payments >= 1;
  const preview = ready ? offerMath({ amount, payback, fees, payments }) : null;

  function submit() {
    if (!f.funder_id) return setProblem("Pick the funder that made the offer.");
    if (amount === null || amount <= 0) return setProblem("Amount must be more than zero.");
    if (payback === null || payback < amount)
      return setProblem("Payback can't be less than the amount.");
    if (fees < 0 || fees > amount) return setProblem("Fees must be between zero and the amount.");
    if (!Number.isInteger(payments) || payments < 1)
      return setProblem("Number of payments must be a whole number.");
    setProblem("");
    onSave({
      ...f,
      amount,
      payback,
      fees,
      payments,
      frequency: f.frequency,
      notes: f.notes.trim(),
    });
  }

  return (
    <div className="mt-4 grid gap-3 rounded-xl bg-sand p-4 sm:grid-cols-2">
      <Field label="Funder">
        <select
          className={input}
          value={f.funder_id}
          onChange={(e) => set("funder_id")(e.target.value)}
        >
          <option value="">Pick a funder</option>
          {funders.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount offered">
        <input
          className={input}
          inputMode="decimal"
          value={f.amount}
          onChange={(e) => set("amount")(e.target.value)}
        />
      </Field>
      <Field label="Total payback">
        <input
          className={input}
          inputMode="decimal"
          value={f.payback}
          onChange={(e) => set("payback")(e.target.value)}
        />
      </Field>
      <Field label="Fees taken out">
        <input
          className={input}
          inputMode="decimal"
          value={f.fees}
          onChange={(e) => set("fees")(e.target.value)}
        />
      </Field>
      <Field label="Payments">
        <select
          className={input}
          value={f.frequency}
          onChange={(e) => set("frequency")(e.target.value)}
        >
          {FREQUENCIES.map((v) => (
            <option key={v} value={v}>
              {FREQUENCY_LABEL[v]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Number of payments">
        <input
          className={input}
          inputMode="numeric"
          value={f.payments}
          onChange={(e) => set("payments")(e.target.value)}
        />
      </Field>
      <Field label="Good until (optional)">
        <input
          className={input}
          type="date"
          value={f.expires}
          onChange={(e) => set("expires")(e.target.value)}
        />
      </Field>
      <Field label="Note (optional)">
        <input className={input} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      {preview && (
        <p className="text-sm sm:col-span-2">
          {preview.factor.toFixed(2)} factor · {usd(Math.round(preview.payment * 100) / 100)} a
          payment · {usd(preview.net)} lands · costs {usd(preview.cost)}
        </p>
      )}
      <p className="text-xs text-smoke sm:col-span-2">
        Saved offers stay hidden from the merchant until someone clicks Show to merchant.
      </p>
      {problem && <p className="text-sm text-destructive sm:col-span-2">{problem}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="button"
          className={cn(btnPrimary, "px-5 py-2")}
          disabled={busy}
          onClick={submit}
        >
          {busy ? "Saving…" : "Save offer"}
        </button>
        <button type="button" className={chip} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FundForm({
  offer,
  points,
  busy,
  onFund,
}: {
  offer: Offer;
  points: number | null;
  busy: boolean;
  onFund: (v: { date: string; amount: number; points: number | null }) => void;
}) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(String(offer.amount));
  const [pts, setPts] = useState(points === null ? "" : String(points));
  const amt = parseMoney(amount);
  const p = pts.trim() === "" ? null : Number(pts);
  const due = amt !== null && p !== null && Number.isFinite(p) ? commissionDue(amt, p) : null;
  return (
    <div className="mt-5 rounded-xl border border-line p-4" data-fund-form>
      <h4 className="font-semibold">Record the funding</h4>
      <p className="mt-1 text-sm text-smoke">
        Once the funder confirms the money went out. This marks the file funded and shows the
        merchant.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Funded on">
          <input
            className={input}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Funded amount">
          <input
            className={input}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Commission points">
          <input
            className={input}
            inputMode="decimal"
            value={pts}
            onChange={(e) => setPts(e.target.value)}
          />
        </Field>
      </div>
      <p className="mt-2 text-sm">
        {due !== null ? `Commission owed to Lamp: ${usd(due)}` : "No commission recorded."}
      </p>
      <button
        type="button"
        className={cn(btnPrimary, "mt-3 px-5 py-2")}
        disabled={busy || amt === null || amt <= 0 || !date}
        onClick={() =>
          amt !== null &&
          onFund({ date, amount: amt, points: p !== null && Number.isFinite(p) ? p : null })
        }
      >
        {busy ? "Saving…" : "Mark funded"}
      </button>
    </div>
  );
}
