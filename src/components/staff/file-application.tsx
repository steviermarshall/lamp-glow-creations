import { useState } from "react";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { fmtEin, fmtSsn, maskSsn, missing } from "@/lib/application-details";
import { RESTRICTED, revealFullApplication, type FullApplication } from "@/lib/full-application";

/**
 * The merchant's full application on a file, read-only for staff: what they entered, whether
 * it is signed and when, and what is still missing. Only an admin or the file's rep sees it at
 * all. The database sends SSNs cut to the last four and dates of birth hidden; Show SSN asks for
 * the full numbers, and the database logs who asked before answering.
 * Admins can correct a signed application in the database; this screen does not edit it.
 */

export function FileApplication({
  fileId,
  full,
}: {
  fileId: string;
  full: FullApplication | typeof RESTRICTED | null | undefined;
}) {
  const [revealed, setRevealed] = useState<FullApplication | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");
  if (full === undefined) return null;
  if (full === RESTRICTED) {
    return (
      <section className={cn(card, "p-6")} data-full-application="restricted">
        <h3 className="font-display text-lg font-semibold">Full application</h3>
        <p className="mt-2 text-sm text-smoke">
          Only an admin or the rep this file is assigned to can see the full application, because it
          holds SSNs and dates of birth. Take the file to see it.
        </p>
      </section>
    );
  }
  if (full === null) {
    return (
      <section className={cn(card, "p-6")} data-full-application="none">
        <h3 className="font-display text-lg font-semibold">Full application</h3>
        <p className="mt-2 text-sm text-smoke">
          The merchant hasn't started the full application yet. It's on their account page under
          "Complete and sign your application".
        </p>
      </section>
    );
  }
  const { details: d, signedName, signedAt } = full;
  const b = d.business;
  const todo = missing(d);
  const row = (label: string, value: string) =>
    value ? (
      <div className="grid grid-cols-[9rem_1fr] gap-2">
        <dt className="text-smoke">{label}</dt>
        <dd className="font-semibold break-words">{value}</dd>
      </div>
    ) : null;

  return (
    <section className={cn(card, "p-6")} data-full-application={signedAt ? "signed" : "draft"}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-display text-lg font-semibold">Full application</h3>
        <span className={cn("text-sm", signedAt ? "font-semibold text-amber-deep" : "text-smoke")}>
          {signedAt ? `Signed by ${signedName} · ${stamp(signedAt)}` : "Draft, not signed yet"}
        </span>
        <button
          type="button"
          className="ml-auto text-xs font-semibold underline"
          disabled={revealing}
          onClick={async () => {
            if (revealed) {
              setRevealed(null);
              return;
            }
            setRevealing(true);
            setRevealError("");
            try {
              setRevealed(await revealFullApplication(fileId, "reveal_ssn"));
            } catch (e) {
              setRevealError(e instanceof Error ? e.message : "Couldn't show the SSN.");
            } finally {
              setRevealing(false);
            }
          }}
        >
          {revealed ? "Hide SSN" : revealing ? "Opening…" : "Show SSN"}
        </button>
      </div>
      {revealError && <p className="mt-2 text-sm text-destructive">{revealError}</p>}
      {revealed && (
        <p className="mt-2 text-xs text-smoke">
          Showing SSNs and dates of birth. This view is recorded in the access log.
        </p>
      )}
      {!signedAt && todo.length > 0 && (
        <p className="mt-2 text-sm text-smoke">Still missing: {todo.join(", ")}.</p>
      )}
      <dl className="mt-4 space-y-2 text-sm">
        {row("Legal name", b.legal_name)}
        {row("DBA", b.dba)}
        {row("Address", [b.address, b.city, b.state, b.zip].filter(Boolean).join(", "))}
        {row("Phone / email", [b.phone, b.email].filter(Boolean).join(" · "))}
        {row("Started", b.start_date)}
        {row("EIN", fmtEin(b.ein))}
        {row("Entity", b.entity_type)}
        {row("Industry", b.industry)}
        {row("Revenue / month", b.monthly_revenue && `$${b.monthly_revenue.replace(/\$/g, "")}`)}
        {row("Card sales / month", b.card_volume && `$${b.card_volume.replace(/\$/g, "")}`)}
        {row(
          "Bank",
          [b.bank, b.deposit_count && `${b.deposit_count} deposits a month`]
            .filter(Boolean)
            .join(" · "),
        )}
        {row(
          "Premises",
          b.premises === "rent"
            ? `Rents${b.rent ? `, $${b.rent} a month` : ""}`
            : b.premises === "own"
              ? "Owns"
              : "",
        )}
        {row("Liens / judgments", b.liens === "yes" ? "Yes" : b.liens === "no" ? "No" : "")}
        {row(
          "Requested",
          [
            d.request.amount && `$${d.request.amount.replace(/\$/g, "")}`,
            d.request.term && `${d.request.term} months`,
          ]
            .filter(Boolean)
            .join(" · "),
        )}
      </dl>
      {d.owners.map((o, i) => (
        <dl key={i} className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          {row(
            i === 0 ? "Owner" : "Second owner",
            [
              `${o.first} ${o.last}`.trim(),
              o.title,
              o.ownership && `${o.ownership.replace(/%/g, "")}%`,
            ]
              .filter(Boolean)
              .join(" · "),
          )}
          {row("Home", [o.address, o.city, o.state, o.zip].filter(Boolean).join(", "))}
          {row("Mobile / email", [o.mobile, o.email].filter(Boolean).join(" · "))}
          {row("Date of birth", revealed?.details.owners[i]?.dob ?? o.dob)}
          {row("SSN", revealed ? fmtSsn(revealed.details.owners[i]?.ssn ?? "") : maskSsn(o.ssn))}
          {row("Credit (stated)", o.credit)}
        </dl>
      ))}
      {d.balances.length > 0 && (
        <div className="mt-4 border-t border-line pt-4 text-sm">
          <p className="font-semibold">Current advances</p>
          <ul className="mt-2 space-y-1 text-smoke">
            {d.balances.map((x, i) => (
              <li key={i}>
                {[
                  x.funder,
                  x.current && `balance ${x.current}`,
                  x.payment && `payment ${x.payment}`,
                  x.payoff && `payoff ${x.payoff}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
