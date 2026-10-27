import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { BANKRUPTCY, fmtEin, fmtSsn, maskSsn, missing } from "@/lib/application-details";
import { RESTRICTED, revealFullApplication, type FullApplication } from "@/lib/full-application";
import {
  amount,
  BORROWERS,
  CONDITIONS,
  equityOf,
  flags,
  labelOf,
  LIEN_TYPES,
  LISTED,
  PAYMENT_STATUS,
  pct,
  PROPERTY_TYPES,
  PROPERTY_USES,
  STRUCTURES,
  TITLE_HOLDERS,
  usd0,
  VALUE_SOURCES,
  type Property,
  type RealEstate,
} from "@/lib/real-estate";

/**
 * The merchant's full application on a file, read-only for staff: what they entered, whether
 * it is signed and when, and what is still missing. Only an admin or the file's rep sees it at
 * all. The database sends SSNs cut to the last four and dates of birth hidden; Show SSN asks for
 * the full numbers, and the database logs who asked before answering.
 * Nobody edits a signed application, admins included: a correction is "Send back for changes"
 * (the merchant signs the update as a new version) or a staff note.
 * A signed one shows the drawn signatures and how it was signed (from a link or their account,
 * with the address and device) for the audit trail.
 */

type Row = (label: string, value: string) => ReactNode;

/** "$450,000" from whatever the merchant typed; their own words when it isn't a number. */
const money = (s: string) => {
  const n = amount(s);
  return n == null ? s.trim() : usd0(n);
};

const yesNo = (v: string) =>
  v === "yes" ? "Yes" : v === "no" ? "No" : v === "not_sure" ? "Not sure" : "";

/** "2019-03" → "Mar 2019". */
const month = (ym: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m
    ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      })
    : ym;
};

/** "iPhone · Safari" from a user agent: enough to recognise the device, the full text on hover. */
function device(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /FxiOS|Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  const short = [os, browser].filter(Boolean).join(" · ");
  return short || (ua.length > 48 ? `${ua.slice(0, 48)}…` : ua);
}

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
  const row: Row = (label, value) =>
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
        <span className={cn("text-sm", signedAt ? "font-semibold text-forest" : "text-smoke")}>
          {signedAt
            ? `Signed by ${signedName} · ${stamp(signedAt)}${full.version && full.version > 1 ? ` · version ${full.version} (updated)` : ""}`
            : "Draft, not signed yet"}
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
      {signedAt && <Signed full={full} />}
      {!signedAt && todo.length > 0 && (
        <p className="mt-2 text-sm text-smoke">Still missing: {todo.join(", ")}.</p>
      )}
      <dl className="mt-4 space-y-2 text-sm">
        {row("Legal name", b.legal_name)}
        {row("DBA", b.dba)}
        {row("Address", [b.address, b.city, b.state, b.zip].filter(Boolean).join(", "))}
        {row("Phone / email", [b.phone, b.email].filter(Boolean).join(" · "))}
        {row("Website", b.website)}
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
          "Bankruptcy",
          b.bankruptcy
            ? `${labelOf(BANKRUPTCY, b.bankruptcy)}${b.bankruptcy !== "none" && b.bankruptcy_year ? ` (${b.bankruptcy_year})` : ""}`
            : "",
        )}
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
                  x.payment && `payment ${x.payment}${x.frequency ? ` ${x.frequency}` : ""}`,
                  x.payoff && `payoff ${x.payoff}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <RealEstateBlock r={d.real_estate} row={row} />
    </section>
  );
}

/** The drawn signatures and how, where and from what the application was signed. */
function Signed({ full }: { full: FullApplication }) {
  const ink = (src: string, who: string) => (
    <figure>
      {/* white paper under the ink, so a dark pen shows on the night theme */}
      <div className="rounded-xl bg-[#fff] px-3 py-2 ring-1 ring-line">
        <img src={src} alt={`Signature of ${who}`} className="h-16 w-auto max-w-full" />
      </div>
      <figcaption className="mt-1 text-xs text-smoke">{who}</figcaption>
    </figure>
  );
  const how =
    full.signedVia === "link"
      ? "Signed from the application link"
      : full.signedVia === "account"
        ? "Signed from their account"
        : "";
  return (
    <div className="mt-3" data-signature={full.signedVia ?? "unknown"}>
      {(full.signatureImage || full.signatureImage2) && (
        <div className="flex flex-wrap gap-4">
          {full.signatureImage && ink(full.signatureImage, full.signedName ?? "Owner")}
          {full.signatureImage2 && ink(full.signatureImage2, full.signedName2 ?? "Second owner")}
        </div>
      )}
      {full.signedName2 && !full.signatureImage2 && (
        <p className="mt-2 text-sm">
          Second owner signed as <span className="font-semibold">{full.signedName2}</span>
        </p>
      )}
      {(how || full.signerIp || full.signerAgent) && (
        <p className="mt-2 text-xs text-smoke">
          {[how, full.signerIp && `IP ${full.signerIp}`].filter(Boolean).join(" · ")}
          {full.signerAgent && (
            <span title={full.signerAgent}>
              {how || full.signerIp ? " · " : ""}
              {device(full.signerAgent)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * What the merchant owns and owes on it, with the equity a property-backed partner would see and
 * what they'd stop on. The numbers are the merchant's own; nothing here is a verdict.
 */
function RealEstateBlock({ r, row }: { r: RealEstate; row: Row }) {
  if (r.owns === "no") {
    return (
      <div className="mt-4 border-t border-line pt-4 text-sm" data-real-estate="none">
        <p className="font-semibold">Real estate</p>
        <p className="mt-1 text-smoke">Owns no real estate.</p>
      </div>
    );
  }
  if (r.owns !== "yes") return null;
  const want = r.interest === "yes" || r.interest === "maybe";
  return (
    <div className="mt-4 border-t border-line pt-4 text-sm" data-real-estate={r.properties.length}>
      <p className="font-semibold">Real estate</p>
      <dl className="mt-2 space-y-2">
        {row(
          "Use the equity",
          r.interest === "maybe" ? "Maybe" : r.interest ? yesNo(r.interest) : "",
        )}
        {/* answers hidden on the page when they said No are not shown (older rows may hold them) */}
        {want && row("How they'd want it", labelOf(STRUCTURES, r.structure))}
        {want && row("Funds would go to", labelOf(BORROWERS, r.borrower))}
        {want && row("What it's for", r.purpose_note.trim())}
        {row(
          "Foreclosure or short sale, 7 years",
          r.foreclosure === "yes"
            ? `Yes${r.foreclosure_year ? `, ${r.foreclosure_year}` : ""}`
            : yesNo(r.foreclosure),
        )}
      </dl>
      {r.properties.map((p, i) => (
        <PropertyBlock key={i} p={p} n={r.properties.length > 1 ? i + 1 : 0} row={row} />
      ))}
    </div>
  );
}

function PropertyBlock({ p, n, row }: { p: Property; n: number; row: Row }) {
  const e = equityOf(p);
  const warn = flags(p);
  const place = [p.address, p.city, [p.state.toUpperCase(), p.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const liens = p.free_clear ? [] : p.liens.filter((l) => l.type);
  return (
    <div className="mt-4 rounded-xl bg-sand p-4" data-property={n || 1}>
      <p className="font-semibold">
        {n ? `Property ${n}: ` : ""}
        {place || "No address"}
      </p>
      <dl className="mt-3 space-y-2">
        {row(
          "Type / use",
          [labelOf(PROPERTY_TYPES, p.type), labelOf(PROPERTY_USES, p.use)]
            .filter(Boolean)
            .join(" · "),
        )}
        {row("On title", labelOf(TITLE_HOLDERS, p.title))}
        {row("Everyone on title signs", yesNo(p.all_sign))}
        {row(
          "Bought",
          [p.purchased && month(p.purchased), p.price && `for ${money(p.price)}`]
            .filter(Boolean)
            .join(" "),
        )}
        {row(
          "Worth today",
          [p.value && money(p.value), labelOf(VALUE_SOURCES, p.value_source)]
            .filter(Boolean)
            .join(" · "),
        )}
        {(p.use === "rental" || p.use === "owner_rental") &&
          row("Rent", p.rent && `${money(p.rent)} a month`)}
        {row("Condition", labelOf(CONDITIONS, p.condition))}
        {row("Listed for sale", labelOf(LISTED, p.listed))}
        {row(
          "Taxes / insurance",
          [
            p.taxes_current && `Taxes ${p.taxes_current === "yes" ? "current" : "behind"}`,
            p.insured && (p.insured === "yes" ? "Insured" : "Not insured"),
          ]
            .filter(Boolean)
            .join(" · "),
        )}
        {row(
          "HOA",
          p.hoa === "yes"
            ? `Yes${p.hoa_dues ? `, ${money(p.hoa_dues)} a month` : ""}`
            : yesNo(p.hoa),
        )}
      </dl>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-smoke">Owed on it</p>
      {p.free_clear ? (
        <p className="mt-1">Owned free and clear</p>
      ) : liens.length === 0 ? (
        <p className="mt-1 text-smoke">Nothing listed</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {liens.map((l, i) => (
            <li key={i}>
              <span className="font-semibold">
                {[labelOf(LIEN_TYPES, l.type) || "Balance", l.holder.trim()]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="block text-smoke">
                {[
                  l.balance && `balance ${money(l.balance)}`,
                  l.type === "heloc" && l.limit && `limit ${money(l.limit)}`,
                  l.payment && `${money(l.payment)} a month`,
                  labelOf(PAYMENT_STATUS, l.status),
                  l.late_12m && `${l.late_12m} late in 12 months`,
                  l.payoff === "yes" ? "pay off with new funding" : l.payoff === "no" ? "keep" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-smoke">Equity</p>
      <dl className="mt-1 space-y-2">
        {row("Total owed", usd0(e.owed))}
        {row("Equity", usd0(e.equity))}
        {row("Owed ÷ value (CLTV)", pct(e.cltv))}
        {e.owedAtLimits > e.owed && row("Owed, lines at full limit", usd0(e.owedAtLimits))}
        {e.owedAtLimits > e.owed && row("At full limits ÷ value (HCLTV)", pct(e.hcltv))}
        {row(
          "Room up to",
          e.value
            ? [0.65, 0.7, 0.75, 0.8].map((cap) => `${pct(cap)} ${usd0(e.roomAt(cap))}`).join(" · ")
            : "",
        )}
      </dl>

      {warn.length > 0 && (
        <div className="mt-3" data-property-flags={warn.length}>
          <p className="text-xs font-semibold text-destructive">Check first</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-smoke">
            {warn.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
