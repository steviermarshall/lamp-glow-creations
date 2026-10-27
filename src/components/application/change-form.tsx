import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, MessageSquareText, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cleanDetails,
  isMaskedDob,
  isMaskedSsn,
  missing,
  signatureMatches,
  type Details,
  type Owner,
} from "@/lib/application-details";
import { amount, usd0 } from "@/lib/real-estate";
import { diffDetails } from "@/lib/application-diff";
import type { ChangeItem, ChangeSection } from "@/lib/application-changes";
import {
  BusinessSection,
  FundingSection,
  OwnersSection,
  RealEstateSection,
  type Update,
} from "@/components/application/sections";
import { SignBlock } from "@/components/application/sign-block";
import { emptySigning, type Signing } from "@/components/application/form-kit";

/**
 * Updating a signed application after "Send back for changes": what the rep asked for, the
 * application as they signed it with the asked-for parts open, what they changed so far, and
 * signing again. Shared by the update link page and the account page; the page does the saving.
 * Merchant copy: never the word "loan".
 */

type SectionId = Exclude<ChangeSection, "other">;

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "business", title: "Business" },
  { id: "owners", title: "Owners" },
  { id: "property", title: "Real estate" },
  { id: "funding", title: "Funding" },
];

/** One line about what a section holds now, for the closed view. */
function summary(d: Details, id: SectionId): string {
  if (id === "business")
    return [d.business.legal_name, [d.business.city, d.business.state].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · ");
  if (id === "owners")
    return d.owners
      .map((o) => `${o.first} ${o.last}`.trim())
      .filter(Boolean)
      .join(" and ");
  if (id === "property") {
    const re = d.real_estate;
    if (re.owns === "no") return "Doesn't own real estate";
    if (re.owns !== "yes") return "";
    const n = re.properties.length;
    return `${n} propert${n === 1 ? "y" : "ies"}`;
  }
  const amt = amount(d.request.amount);
  const bal = d.balances.length;
  return [
    amt ? `Asking for ${usd0(amt)}` : "",
    bal ? `${bal} current balance${bal === 1 ? "" : "s"}` : "No current balances",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Same person: the names compared without case, spaces or punctuation (as _same_person). */
const samePerson = (a: Owner | undefined, b: Owner | undefined) => {
  const n = (o: Owner | undefined) =>
    `${o?.first ?? ""}${o?.last ?? ""}`.toLowerCase().replace(/[^\p{L}]/gu, "");
  return !!n(a) && n(a) === n(b);
};

/**
 * An SSN or date of birth on file stays only with the owner it belongs to: when an owner's name
 * changes, Lamp's server can't keep it, so the page asks for it again right away.
 */
function dropKeptForRenamed(base: Details, d: Details): Details {
  let changed = false;
  const owners = d.owners.map((o, i) => {
    const b = base.owners[i];
    if ((isMaskedSsn(o.ssn) || isMaskedDob(o.dob)) && !samePerson(b, o)) {
      changed = true;
      return { ...o, ssn: isMaskedSsn(o.ssn) ? "" : o.ssn, dob: isMaskedDob(o.dob) ? "" : o.dob };
    }
    return o;
  });
  return changed ? { ...d, owners } : d;
}

export function ChangeForm({
  base,
  items,
  message,
  repName,
  secondSignedBefore = false,
  busy,
  error,
  onSign,
  cta,
}: {
  /** The application as they signed it (SSN and date of birth on file on an update link). */
  base: Details;
  items: ChangeItem[];
  message: string | null;
  /** Null when the file has no rep right now. */
  repName: string | null;
  /** The second owner signed the version being updated: they sign this one too. */
  secondSignedBefore?: boolean;
  busy: boolean;
  /** An error from saving, shown with the sign button. */
  error: string;
  onSign: (d: Details, s: Signing) => void;
  cta: string;
}) {
  const asked = useMemo(
    () => new Set(items.map((i) => i.section).filter((x): x is SectionId => x !== "other")),
    [items],
  );
  const [d, setD] = useState<Details>(base);
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(asked));
  const [sig, setSig] = useState<Signing>(() => ({
    ...emptySigning(),
    second: secondSignedBefore,
  }));
  const [localError, setLocalError] = useState("");
  const update: Update = (fn) => setD((x) => dropKeptForRenamed(base, fn(x)));
  const todo = missing(d);
  const changes = useMemo(() => diffDetails(base, cleanDetails(d)), [base, d]);
  const repFirst = repName?.split(" ")[0] || null;
  // owners whose name changed: what was on file has to be typed again
  const retype = d.owners.filter(
    (o, i) =>
      (isMaskedSsn(base.owners[i]?.ssn ?? "") || isMaskedDob(base.owners[i]?.dob ?? "")) &&
      !samePerson(base.owners[i], o),
  );
  // on file, then cleared with Change but nothing typed yet: offer it back
  const cleared = d.owners.some(
    (o, i) =>
      samePerson(base.owners[i], o) &&
      ((isMaskedSsn(base.owners[i]?.ssn ?? "") && !o.ssn) ||
        (isMaskedDob(base.owners[i]?.dob ?? "") && !o.dob)),
  );
  const keepOnFile = () =>
    setD((x) => ({
      ...x,
      owners: x.owners.map((o, i) => {
        const b = base.owners[i];
        if (!b || !samePerson(b, o)) return o;
        return {
          ...o,
          ssn: !o.ssn && isMaskedSsn(b.ssn) ? b.ssn : o.ssn,
          dob: !o.dob && isMaskedDob(b.dob) ? b.dob : o.dob,
        };
      }),
    }));
  const co = d.owners[1];

  const toggle = (id: SectionId) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sign = () => {
    setLocalError("");
    const owner = d.owners[0]!;
    if (todo.length) return setLocalError("Fill in everything listed above before signing.");
    if (!sig.agree) return setLocalError("Tick the box to agree to the authorization.");
    if (!signatureMatches(sig.typed, owner))
      return setLocalError(
        `Type your full name as the owner, ${owner.first} ${owner.last}, to sign.`,
      );
    if (!sig.image) return setLocalError("Draw your signature in the box.");
    if (sig.second && co) {
      if (!signatureMatches(sig.typed2, co))
        return setLocalError(`${co.first} types their full name, ${co.first} ${co.last}, to sign.`);
      if (!sig.image2) return setLocalError(`${co.first} draws their signature in the box.`);
    }
    onSign(cleanDetails(d), sig);
  };

  const body = (id: SectionId): ReactNode =>
    id === "business" ? (
      <BusinessSection d={d} update={update} />
    ) : id === "owners" ? (
      <>
        {retype.length > 0 && (
          <p className="mb-5 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line" role="status">
            A name changed, so type the SSN and date of birth again for{" "}
            {retype.map((o) => `${o.first} ${o.last}`.trim() || "that owner").join(" and ")}.
          </p>
        )}
        {cleared && (
          <button
            type="button"
            onClick={keepOnFile}
            className="mb-5 text-sm font-semibold text-forest underline-offset-4 hover:underline"
          >
            Keep the SSN and date of birth on file instead
          </button>
        )}
        <OwnersSection d={d} update={update} />
      </>
    ) : id === "property" ? (
      <RealEstateSection d={d} update={update} />
    ) : (
      <FundingSection d={d} update={update} />
    );

  return (
    <div className="space-y-6" data-change-form>
      <section className="rounded-[1.5rem] bg-white p-5 ring-1 ring-leaf/40 sm:p-7" data-asked>
        <p className="flex items-center gap-2 text-sm font-semibold text-forest">
          <MessageSquareText className="size-4" /> {repFirst ?? "Your Lamp rep"} asked for an update
        </p>
        {message && <p className="mt-3 whitespace-pre-line leading-relaxed">{message}</p>}
        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((i) => (
              <li key={`${i.section}-${i.label}`} className="flex gap-2.5 text-[0.95rem]">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-leaf" />
                <span>
                  <span className="font-semibold">{i.label}</span>
                  {i.note && <span className="text-smoke"> · {i.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-smoke">
          Everything you signed before is filled in below. Change what's needed, check it over and
          sign again. Your SSN and date of birth stay on file unless you change them.
        </p>
      </section>

      <div className="space-y-3">
        {SECTIONS.map(({ id, title }) => {
          const isOpen = open.has(id);
          const isAsked = asked.has(id);
          const edits = changes.filter((c) => c.section === id).length;
          return (
            <section
              key={id}
              data-section={id}
              data-asked={isAsked || undefined}
              className={cn(
                "overflow-hidden rounded-[1.5rem] bg-white ring-1",
                isAsked ? "ring-2 ring-leaf/70" : "ring-line",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-7"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
                    {title}
                    {isAsked && (
                      <span className="rounded-full bg-leaf/20 px-2.5 py-0.5 font-sans text-xs font-semibold text-forest">
                        Asked for
                      </span>
                    )}
                    {edits > 0 && (
                      <span className="rounded-full px-2.5 py-0.5 font-sans text-xs font-semibold text-smoke ring-1 ring-line">
                        {edits} change{edits === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  {!isOpen && (
                    <span className="mt-0.5 block truncate text-sm text-smoke">
                      {summary(d, id)}
                    </span>
                  )}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-forest">
                  {isOpen ? "Close" : "Change"}
                  <ChevronDown className={cn("size-4 transition", isOpen && "rotate-180")} />
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-line px-5 pb-6 pt-5 sm:px-7">
                  {isAsked && (
                    <ul className="mb-5 space-y-1 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
                      {items
                        .filter((i) => i.section === id)
                        .map((i) => (
                          <li key={i.label} className="font-semibold">
                            {i.label}
                          </li>
                        ))}
                    </ul>
                  )}
                  {body(id)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section
        className="rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7"
        data-what-changed={changes.length}
      >
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
          <PenLine className="size-4 text-forest" /> What you changed
        </h3>
        {changes.length === 0 ? (
          <p className="mt-2 text-sm text-smoke">
            Nothing yet. Open a section above to add what {repFirst ?? "your rep"} asked for. If
            everything is already right, you can sign as it is.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {changes.map((c) => (
              <li key={c.path} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-forest" />
                <span className="min-w-0 break-words">
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-smoke">
                    {c.secret
                      ? ": you typed a new one"
                      : c.kind === "added"
                        ? `: ${c.after}`
                        : c.kind === "removed"
                          ? `: removed (was ${c.before})`
                          : `: ${c.before} → ${c.after}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7">
        {secondSignedBefore && co && (
          <p className="mb-6 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
            {co.first || "The second owner"} signed the application last time, so they sign this
            update too.
          </p>
        )}
        <SignBlock
          d={d}
          s={sig}
          set={(patch) => setSig((x) => ({ ...x, ...patch }))}
          todo={todo}
          error={localError || error}
          busy={busy}
          onSign={sign}
          cta={cta}
        />
      </div>
    </div>
  );
}
