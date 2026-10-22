import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary, card } from "@/components/site/layout";
import { FREQUENCY_LABEL, usd, type Frequency, type OfferStatus } from "@/lib/money";

/**
 * The merchant's offers, from the my_offers view: only offers a Lamp rep has presented (the
 * database hides "received" ones), shown in dollars the Offer Check way. Accepting calls
 * accept_offer(), which checks the offer is the merchant's, still presented and not expired,
 * declines the others and moves the file to accepted. Merchant copy: never the word "loan".
 */

type Offer = {
  id: string;
  funder_name: string | null;
  amount: number;
  payback: number;
  fees: number;
  payment: number;
  payments: number;
  frequency: Frequency;
  received_net: number;
  status: OfferStatus;
  expires_at: string | null;
  accepted_at: string | null;
};

const per: Record<Frequency, string> = {
  daily: "business day",
  weekly: "week",
  biweekly: "two weeks",
  monthly: "month",
};

export function MyOffers({ applicationId }: { applicationId: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("my_offers")
      .select(
        "id,funder_name,amount,payback,fees,payment,payments,frequency,received_net,status,expires_at,accepted_at",
      )
      .eq("application_id", applicationId)
      .in("status", ["presented", "accepted"])
      .order("amount", { ascending: false })
      .then(({ data }) =>
        setOffers(
          ((data as Offer[] | null) ?? []).map((o) => ({
            ...o,
            amount: +o.amount,
            payback: +o.payback,
            fees: +o.fees,
            payment: +o.payment,
            received_net: +o.received_net,
          })),
        ),
      );
  }, [applicationId, reload]);

  if (offers.length === 0) return null;
  const accepted = offers.find((o) => o.status === "accepted");

  async function accept(o: Offer) {
    const sb = getSupabase();
    if (!sb) return;
    if (
      !window.confirm(
        `Accept ${usd(o.amount)} from ${o.funder_name ?? "this funder"}? Your other offers will be closed, and your rep will send the funder's agreement for you to review and sign.`,
      )
    )
      return;
    setBusy(o.id);
    setError("");
    const { error: e } = await sb.rpc("accept_offer", { _offer_id: o.id });
    setBusy(null);
    if (e) {
      setError(
        /expired/i.test(e.message)
          ? "This offer has expired. Your rep can ask the funder for a fresh one."
          : "Couldn't accept this offer. Call or text your rep and they'll sort it out.",
      );
      return;
    }
    setReload((n) => n + 1);
  }

  return (
    <section className={cn(card, "p-6")} data-my-offers>
      <h2 className="font-display text-lg font-semibold">
        {accepted ? "Your offer" : "Your offers"}
      </h2>
      <p className="mt-2 text-sm text-smoke">
        {accepted
          ? "You accepted this offer. Your rep will send the funder's agreement to review and sign before any money moves."
          : "Compare what lands in your account, what you pay each time, and the total cost. Nothing is final until you sign the funder's agreement."}
      </p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <ul className="mt-4 space-y-3">
        {(accepted ? [accepted] : offers).map((o) => {
          const expired = o.expires_at !== null && new Date(o.expires_at) < new Date();
          return (
            <li key={o.id} className="rounded-xl bg-sand p-4 text-sm" data-offer={o.status}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-xl font-bold tabular-nums">{usd(o.amount)}</span>
                <span className="text-smoke">from {o.funder_name ?? "a funding partner"}</span>
                {o.status === "accepted" && (
                  <span className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-deep">
                    <Check className="size-4" /> Accepted
                  </span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-smoke">Lands in your account</dt>
                  <dd className="font-semibold tabular-nums">{usd(o.received_net)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-smoke">Each payment</dt>
                  <dd className="font-semibold tabular-nums">
                    {usd(o.payment)} a {per[o.frequency]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-smoke">Payments</dt>
                  <dd className="font-semibold tabular-nums">
                    {o.payments} {FREQUENCY_LABEL[o.frequency].toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-smoke">Total cost</dt>
                  <dd className="font-semibold tabular-nums">
                    {usd(o.payback - o.amount + o.fees)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-smoke">
                You pay back {usd(o.payback)} in total.
                {o.expires_at &&
                  ` ${expired ? "Expired" : "Good until"} ${new Date(o.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`}
              </p>
              {o.status === "presented" && !accepted && (
                <button
                  type="button"
                  className={cn(btnPrimary, "mt-3 px-5 py-2.5")}
                  disabled={busy !== null || expired}
                  onClick={() => accept(o)}
                >
                  {busy === o.id ? "Accepting…" : "Accept this offer"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
