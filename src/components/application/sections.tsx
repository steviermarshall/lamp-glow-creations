import { useState } from "react";
import { Eye, EyeOff, Home, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BANKRUPTCY,
  CREDIT_BANDS,
  emptyBalance,
  emptyOwner,
  ENTITY_TYPES,
  INDUSTRIES,
  MAX_BALANCES,
  USES,
  type Balance,
  type Business,
  type Details,
  type Owner,
} from "@/lib/application-details";
import {
  BORROWERS,
  CONDITIONS,
  emptyLien,
  emptyProperty,
  equityOf,
  LIEN_TYPES,
  LISTED,
  MAX_LIENS,
  MAX_PROPERTIES,
  PAYMENT_STATUS,
  pct,
  PROPERTY_TYPES,
  PROPERTY_USES,
  STRUCTURES,
  TITLE_HOLDERS,
  usd0,
  VALUE_SOURCES,
  type Lien,
  type Property,
  type RealEstate,
} from "@/lib/real-estate";
import {
  Address,
  Choice,
  F,
  Group,
  inputCls,
  Money,
  MonthYear,
  Select,
  Text,
} from "@/components/application/fields";
import { YES_NO } from "@/components/application/form-kit";

/**
 * The full application's sections, shared by the application link page and the merchant's
 * account page. Each takes the whole application and an updater, so either page can keep the
 * state its own way (local draft vs database draft). Merchant copy: never the word "loan".
 */

export type Update = (fn: (d: Details) => Details) => void;

const OTHER_INDUSTRY = "Something else";

export function BusinessSection({ d, update }: { d: Details; update: Update }) {
  const b = d.business;
  const set = (k: keyof Business, v: string) =>
    update((x) => ({ ...x, business: { ...x.business, [k]: v } }));
  const industryKnown = !b.industry || INDUSTRIES.includes(b.industry);
  const [otherIndustry, setOtherIndustry] = useState(!industryKnown);

  return (
    <div className="space-y-10">
      <Group title="Your business">
        <F label="Legal business name">
          <Text
            value={b.legal_name}
            onChange={(v) => set("legal_name", v)}
            autoComplete="organization"
          />
        </F>
        <F label="Doing business as" optional>
          <Text value={b.dba} onChange={(v) => set("dba", v)} placeholder="If different" />
        </F>
        <Address
          label="Business address (no PO boxes)"
          value={b}
          onChange={(k, v) => set(k, k === "state" ? v.toUpperCase() : v)}
        />
        <F label="Business phone">
          <Text value={b.phone} onChange={(v) => set("phone", v)} type="tel" autoComplete="tel" />
        </F>
        <F label="Business email" optional>
          <Text value={b.email} onChange={(v) => set("email", v)} type="email" />
        </F>
        <F label="Website" optional>
          <Text value={b.website} onChange={(v) => set("website", v)} placeholder="example.com" />
        </F>
        <F label="Date the business started">
          <Text value={b.start_date} onChange={(v) => set("start_date", v)} type="date" />
        </F>
        <F label="Federal tax ID (EIN)">
          <Text
            value={b.ein}
            onChange={(v) => set("ein", v)}
            inputMode="numeric"
            placeholder="12-3456789"
            autoComplete="off"
          />
        </F>
        <F label="Entity type">
          <Select
            value={b.entity_type}
            onChange={(v) => set("entity_type", v)}
            options={ENTITY_TYPES}
          />
        </F>
        <F label="Industry">
          <Select
            value={otherIndustry ? OTHER_INDUSTRY : b.industry}
            onChange={(v) => {
              if (v === OTHER_INDUSTRY) {
                setOtherIndustry(true);
                set("industry", "");
              } else {
                setOtherIndustry(false);
                set("industry", v);
              }
            }}
            options={[...INDUSTRIES, OTHER_INDUSTRY]}
          />
        </F>
        {otherIndustry && (
          <F label="What does the business do?">
            <Text value={b.industry} onChange={(v) => set("industry", v)} />
          </F>
        )}
      </Group>

      <Group title="Money in" hint="Averages over the last few months are fine.">
        <F label="Average monthly revenue">
          <Money value={b.monthly_revenue} onChange={(v) => set("monthly_revenue", v)} />
        </F>
        <F label="Monthly card sales" optional>
          <Money value={b.card_volume} onChange={(v) => set("card_volume", v)} />
        </F>
        <F label="Business bank" optional>
          <Text
            value={b.bank}
            onChange={(v) => set("bank", v)}
            placeholder="Chase, TD, Bank of America…"
          />
        </F>
        <F label="Deposits a month" optional hint="Roughly how many deposits hit the account.">
          <Text
            value={b.deposit_count}
            onChange={(v) => set("deposit_count", v.replace(/\D/g, ""))}
            inputMode="numeric"
          />
        </F>
      </Group>

      <Group title="A few yes-or-no questions">
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold">Do you own or rent where the business runs?</p>
          <Choice
            label="Own or rent the business location"
            value={b.premises}
            onChange={(v) => set("premises", v)}
            options={[
              { id: "own", label: "Own" },
              { id: "rent", label: "Rent" },
            ]}
          />
        </div>
        {b.premises === "rent" && (
          <F label="Monthly rent">
            <Money value={b.rent} onChange={(v) => set("rent", v)} />
          </F>
        )}
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold">
            Any liens, judgments or tax liens on the business?
          </p>
          <Choice
            label="Liens or judgments"
            value={b.liens}
            onChange={(v) => set("liens", v)}
            options={YES_NO}
          />
        </div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold">
            Has the business or an owner filed for bankruptcy in the last 7 years?
          </p>
          <Choice
            label="Bankruptcy in the last 7 years"
            value={b.bankruptcy}
            onChange={(v) => set("bankruptcy", v)}
            options={BANKRUPTCY}
          />
        </div>
        {b.bankruptcy && b.bankruptcy !== "none" && (
          <F label="Year it was filed">
            <Text
              value={b.bankruptcy_year}
              onChange={(v) => set("bankruptcy_year", v.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="2021"
            />
          </F>
        )}
      </Group>
    </div>
  );
}

export function OwnersSection({
  d,
  update,
  loginEmailNote = false,
}: {
  d: Details;
  update: Update;
  /** The link page: the first owner's email is also how they'll sign in later. */
  loginEmailNote?: boolean;
}) {
  const setO = (i: number, k: keyof Owner, v: string) =>
    update((x) => ({ ...x, owners: x.owners.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));

  return (
    <div className="space-y-10">
      {d.owners.map((o, i) => (
        <Group
          key={i}
          title={i === 0 ? "You, the owner" : "Second owner"}
          hint={
            i === 0
              ? "Funding partners need the principal owner's details to review the application."
              : "Anyone else who owns 20% or more."
          }
        >
          <F label="First name">
            <Text
              value={o.first}
              onChange={(v) => setO(i, "first", v)}
              autoComplete={i === 0 ? "given-name" : "off"}
            />
          </F>
          <F label="Last name">
            <Text
              value={o.last}
              onChange={(v) => setO(i, "last", v)}
              autoComplete={i === 0 ? "family-name" : "off"}
            />
          </F>
          <F label="Title" optional>
            <Text value={o.title} onChange={(v) => setO(i, "title", v)} placeholder="Owner, CEO…" />
          </F>
          <F label="Ownership">
            <div className="relative">
              <input
                className={cn(inputCls, "pr-8 tabular-nums")}
                inputMode="decimal"
                value={o.ownership}
                onChange={(e) =>
                  setO(i, "ownership", e.target.value.replace(/[^\d.]/g, "").slice(0, 5))
                }
                placeholder="100"
              />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-smoke">
                %
              </span>
            </div>
          </F>
          <Address
            label="Home address"
            value={o}
            onChange={(k, v) => setO(i, k, k === "state" ? v.toUpperCase() : v)}
          />
          <F label="Mobile phone">
            <Text
              value={o.mobile}
              onChange={(v) => setO(i, "mobile", v)}
              type="tel"
              autoComplete={i === 0 ? "tel" : "off"}
            />
          </F>
          <F
            label="Email"
            hint={
              i === 0 && loginEmailNote
                ? "You'll use this to sign in and follow your application."
                : undefined
            }
          >
            <Text
              value={o.email}
              onChange={(v) => setO(i, "email", v)}
              type="email"
              autoComplete={i === 0 ? "email" : "off"}
            />
          </F>
          <F label="Date of birth">
            <Text
              value={o.dob}
              onChange={(v) => setO(i, "dob", v)}
              type="date"
              autoComplete="off"
            />
          </F>
          <F label="Social Security number">
            <SsnInput value={o.ssn} onChange={(v) => setO(i, "ssn", v)} />
          </F>
          <F label="Credit score, your best guess">
            <Select
              value={o.credit}
              onChange={(v) => setO(i, "credit", v)}
              options={CREDIT_BANDS}
            />
          </F>
          {i === 1 && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 self-end text-sm font-semibold text-smoke underline-offset-4 hover:underline"
              onClick={() => update((x) => ({ ...x, owners: x.owners.slice(0, 1) }))}
            >
              <Trash2 className="size-4" /> Remove second owner
            </button>
          )}
        </Group>
      ))}
      {d.owners.length < 2 && (
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-forest ring-1 ring-line hover:ring-ink/30"
          onClick={() => update((x) => ({ ...x, owners: [...x.owners, emptyOwner()] }))}
        >
          <Plus className="size-4" /> Add a second owner
        </button>
      )}
    </div>
  );
}

/** SSN with its dashes put in, hidden by default like a password, with a Show switch. */
function SsnInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const fmt = (raw: string) => {
    const x = raw.replace(/\D/g, "").slice(0, 9);
    return x.length > 5
      ? `${x.slice(0, 3)}-${x.slice(3, 5)}-${x.slice(5)}`
      : x.length > 3
        ? `${x.slice(0, 3)}-${x.slice(3)}`
        : x;
  };
  return (
    <div className="relative">
      <input
        className={cn(
          inputCls,
          "pr-11 tabular-nums tracking-wide",
          !show && "[-webkit-text-security:disc]",
        )}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={fmt(value)}
        placeholder="123-45-6789"
        onChange={(e) => onChange(fmt(e.target.value))}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? "Hide SSN" : "Show SSN"}
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-smoke hover:text-ink"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function FundingSection({ d, update }: { d: Details; update: Update }) {
  const setBal = (i: number, k: keyof Balance, v: string) =>
    update((x) => ({ ...x, balances: x.balances.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));
  const setReq = (patch: Partial<Details["request"]>) =>
    update((x) => ({ ...x, request: { ...x.request, ...patch } }));

  return (
    <div className="space-y-10">
      <Group title="What you're asking for">
        <F label="Amount you'd like">
          <Money
            value={d.request.amount}
            onChange={(v) => setReq({ amount: v })}
            placeholder="50,000"
          />
        </F>
        <F label="Preferred term">
          <Select
            value={d.request.term}
            onChange={(v) => setReq({ term: v as Details["request"]["term"] })}
            placeholder="No preference"
            options={[
              { id: "3", label: "3 months" },
              { id: "6", label: "6 months" },
              { id: "9", label: "9 months" },
              { id: "12", label: "12 months or more" },
            ]}
          />
        </F>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[0.8rem] font-semibold text-smoke">What it's for</legend>
          <div className="flex flex-wrap gap-2">
            {USES.map((u) => {
              const on = d.request.uses.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() =>
                    setReq({
                      uses: on
                        ? d.request.uses.filter((x) => x !== u.id)
                        : [...d.request.uses, u.id],
                    })
                  }
                  className={cn(
                    "rounded-full px-4 py-2.5 text-sm font-semibold transition",
                    on
                      ? "bg-leaf text-ink ring-1 ring-leaf"
                      : "bg-white ring-1 ring-line hover:ring-ink/30",
                  )}
                >
                  {u.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Group>

      <Group
        title="Funding you're paying back now"
        hint="Any cash advance or business funding with a balance today. Skip this if you have none."
      >
        {d.balances.map((b, i) => (
          <div
            key={i}
            className="grid gap-3 rounded-2xl bg-sand p-4 ring-1 ring-line sm:col-span-2 sm:grid-cols-2"
          >
            <F label="Funding company">
              <Text value={b.funder} onChange={(v) => setBal(i, "funder", v)} />
            </F>
            <F label="Original amount">
              <Money value={b.original} onChange={(v) => setBal(i, "original", v)} />
            </F>
            <F label="Balance now">
              <Money value={b.current} onChange={(v) => setBal(i, "current", v)} />
            </F>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <F label="Payment">
                <Money value={b.payment} onChange={(v) => setBal(i, "payment", v)} />
              </F>
              <F label="How often">
                <select
                  className={inputCls}
                  value={b.frequency}
                  onChange={(e) => setBal(i, "frequency", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </F>
            </div>
            <F label="Expected payoff" optional>
              <Text
                value={b.payoff}
                onChange={(v) => setBal(i, "payoff", v)}
                placeholder="Month and year"
              />
            </F>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 self-end justify-self-start text-sm font-semibold text-smoke underline-offset-4 hover:underline"
              onClick={() =>
                update((x) => ({ ...x, balances: x.balances.filter((_, j) => j !== i) }))
              }
            >
              <Trash2 className="size-4" /> Remove
            </button>
          </div>
        ))}
        {d.balances.length < MAX_BALANCES && (
          <button
            type="button"
            className="inline-flex items-center gap-2 justify-self-start rounded-full px-4 py-2.5 text-sm font-semibold text-forest ring-1 ring-line hover:ring-ink/30 sm:col-span-2"
            onClick={() => update((x) => ({ ...x, balances: [...x.balances, emptyBalance()] }))}
          >
            <Plus className="size-4" /> {d.balances.length ? "Add another" : "Add one"}
          </button>
        )}
      </Group>
    </div>
  );
}

export function RealEstateSection({ d, update }: { d: Details; update: Update }) {
  const r = d.real_estate;
  const setR = (patch: Partial<RealEstate>) =>
    update((x) => ({ ...x, real_estate: { ...x.real_estate, ...patch } }));
  const setP = (i: number, patch: Partial<Property>) =>
    update((x) => ({
      ...x,
      real_estate: {
        ...x.real_estate,
        properties: x.real_estate.properties.map((p, j) => (j === i ? { ...p, ...patch } : p)),
      },
    }));

  return (
    <div className="space-y-10">
      <Group
        title="Real estate you own"
        hint="Own your home, a rental, a building or land? It can open larger, longer-term funding. This doesn't commit you to anything."
      >
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-semibold">Do you own any real estate?</p>
          <Choice
            label="Own any real estate"
            value={r.owns}
            onChange={(v) =>
              setR(
                v === "yes" && r.properties.length === 0
                  ? { owns: v, properties: [emptyProperty()] }
                  : { owns: v },
              )
            }
            options={YES_NO}
          />
        </div>
      </Group>

      {r.owns === "yes" && (
        <>
          {r.properties.map((p, i) => (
            <PropertyCard
              key={i}
              index={i}
              count={r.properties.length}
              p={p}
              set={(patch) => setP(i, patch)}
              remove={() => setR({ properties: r.properties.filter((_, j) => j !== i) })}
            />
          ))}
          {r.properties.length < MAX_PROPERTIES && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-forest ring-1 ring-line hover:ring-ink/30"
              onClick={() => setR({ properties: [...r.properties, emptyProperty()] })}
            >
              <Plus className="size-4" /> Add another property
            </button>
          )}

          <Group title="About using your property">
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">
                Any foreclosure, short sale or deed-in-lieu in the last 7 years?
              </p>
              <Choice
                label="Foreclosure in the last 7 years"
                value={r.foreclosure}
                onChange={(v) => setR({ foreclosure: v })}
                options={YES_NO}
              />
            </div>
            {r.foreclosure === "yes" && (
              <F label="Year">
                <Text
                  value={r.foreclosure_year}
                  onChange={(v) => setR({ foreclosure_year: v.replace(/\D/g, "").slice(0, 4) })}
                  inputMode="numeric"
                />
              </F>
            )}
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">
                Would you use a property for larger, longer-term funding?
              </p>
              <Choice
                label="Use property for funding"
                value={r.interest}
                onChange={(v) => setR({ interest: v })}
                options={[
                  { id: "yes", label: "Yes" },
                  { id: "maybe", label: "Maybe" },
                  { id: "no", label: "No" },
                ]}
              />
            </div>
            {(r.interest === "yes" || r.interest === "maybe") && (
              <>
                <F label="How would you want it?">
                  <Select
                    value={r.structure}
                    onChange={(v) => setR({ structure: v })}
                    options={STRUCTURES}
                  />
                </F>
                <F label="Who would receive the funds?">
                  <Select
                    value={r.borrower}
                    onChange={(v) => setR({ borrower: v })}
                    options={BORROWERS}
                  />
                </F>
                <F label="What would the money do for the business?" wide optional>
                  <Text
                    value={r.purpose_note}
                    onChange={(v) => setR({ purpose_note: v.slice(0, 300) })}
                    placeholder="Pay off two advances and buy a second truck"
                  />
                </F>
                <p className="text-xs leading-relaxed text-smoke sm:col-span-2">
                  Funding backed by property is a separate agreement secured by that property: if it
                  isn't repaid, you could lose the property. Lamp is a broker, not a funder, and
                  each funding partner makes its own decision.
                </p>
              </>
            )}
          </Group>
        </>
      )}
    </div>
  );
}

function PropertyCard({
  index,
  count,
  p,
  set,
  remove,
}: {
  index: number;
  count: number;
  p: Property;
  set: (patch: Partial<Property>) => void;
  remove: () => void;
}) {
  const e = equityOf(p);
  const setLien = (j: number, patch: Partial<Lien>) =>
    set({ liens: p.liens.map((l, k) => (k === j ? { ...l, ...patch } : l)) });
  const rental = p.use === "rental" || p.use === "owner_rental";

  return (
    <section
      className="ll-glass rounded-3xl p-5 ring-1 ring-line sm:p-7"
      aria-label={`Property ${index + 1}`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-leaf/15 text-forest ring-1 ring-leaf/30">
          <Home className="size-5" />
        </span>
        <h3 className="font-display text-lg font-semibold">
          {count > 1 ? `Property ${index + 1}` : "Your property"}
          {index === 0 && count > 1 && (
            <span className="ml-2 text-sm font-normal text-smoke">the one you'd use first</span>
          )}
        </h3>
        {count > 1 && (
          <button
            type="button"
            onClick={remove}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-smoke hover:text-ink"
          >
            <Trash2 className="size-4" /> Remove
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Address
          label="Property address"
          value={p}
          onChange={(k, v) =>
            set({ [k]: k === "state" ? v.toUpperCase() : v } as Partial<Property>)
          }
        />
        <F label="What kind of property">
          <Select value={p.type} onChange={(v) => set({ type: v })} options={PROPERTY_TYPES} />
        </F>
        <F label="How you use it">
          <Select value={p.use} onChange={(v) => set({ use: v })} options={PROPERTY_USES} />
        </F>
        <F label="Whose name is on the title">
          <Select value={p.title} onChange={(v) => set({ title: v })} options={TITLE_HOLDERS} />
        </F>
        <div>
          <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">
            Would every owner on the title sign?
          </p>
          <Choice
            label="Every owner would sign"
            value={p.all_sign}
            onChange={(v) => set({ all_sign: v })}
            options={[
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
              { id: "not_sure", label: "Not sure" },
            ]}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-semibold text-smoke">
            When you bought it
          </span>
          <MonthYear
            label="When you bought it"
            value={p.purchased}
            onChange={(v) => set({ purchased: v })}
          />
        </div>
        <F label="What you paid" optional>
          <Money value={p.price} onChange={(v) => set({ price: v })} />
        </F>
        <F label="What it's worth today">
          <Money value={p.value} onChange={(v) => set({ value: v })} />
        </F>
        <F label="Where that number comes from" optional>
          <Select
            value={p.value_source}
            onChange={(v) => set({ value_source: v })}
            options={VALUE_SOURCES}
          />
        </F>
        <F label="Condition">
          <Select
            value={p.condition}
            onChange={(v) => set({ condition: v })}
            options={CONDITIONS}
          />
        </F>
        <F label="Listed for sale?">
          <Select value={p.listed} onChange={(v) => set({ listed: v })} options={LISTED} />
        </F>
        {rental && (
          <F label="Monthly rent it brings in">
            <Money value={p.rent} onChange={(v) => set({ rent: v })} />
          </F>
        )}
        <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">Property taxes paid up?</p>
            <Choice
              label="Taxes current"
              value={p.taxes_current}
              onChange={(v) => set({ taxes_current: v })}
              options={YES_NO}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">Homeowners insurance?</p>
            <Choice
              label="Insured"
              value={p.insured}
              onChange={(v) => set({ insured: v })}
              options={YES_NO}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">HOA?</p>
            <Choice label="HOA" value={p.hoa} onChange={(v) => set({ hoa: v })} options={YES_NO} />
          </div>
        </div>
        {p.hoa === "yes" && (
          <F label="HOA dues a month" optional>
            <Money value={p.hoa_dues} onChange={(v) => set({ hoa_dues: v })} />
          </F>
        )}
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-display text-base font-semibold">What you owe on it</h4>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-4"
              checked={p.free_clear}
              onChange={(ev) => set({ free_clear: ev.target.checked })}
            />
            Owned free and clear
          </label>
        </div>
        {!p.free_clear && (
          <div className="mt-3 space-y-3">
            {p.liens.map((l, j) => (
              <LienRow
                key={j}
                l={l}
                set={(patch) => setLien(j, patch)}
                remove={
                  p.liens.length > 1
                    ? () => set({ liens: p.liens.filter((_, k) => k !== j) })
                    : null
                }
              />
            ))}
            {p.liens.length < MAX_LIENS && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-forest ring-1 ring-line hover:ring-ink/30"
                onClick={() =>
                  set({ liens: [...p.liens, emptyLien(p.liens.length ? "second" : "first")] })
                }
              >
                <Plus className="size-4" /> Add a mortgage, equity line or other balance
              </button>
            )}
          </div>
        )}
      </div>

      <EquityMeter
        value={e.value}
        owed={e.owed}
        equity={e.equity}
        ratio={e.cltv}
        atLimits={e.owedAtLimits > e.owed ? e.owedAtLimits : null}
      />
    </section>
  );
}

function LienRow({
  l,
  set,
  remove,
}: {
  l: Lien;
  set: (patch: Partial<Lien>) => void;
  remove: (() => void) | null;
}) {
  return (
    <div className="grid gap-3 rounded-2xl bg-sand p-4 ring-1 ring-line sm:grid-cols-6">
      <div className="sm:col-span-2">
        <F label="Type">
          <Select value={l.type} onChange={(v) => set({ type: v })} options={LIEN_TYPES} />
        </F>
      </div>
      <div className="sm:col-span-2">
        <F label="Who it's with">
          <Text
            value={l.holder}
            onChange={(v) => set({ holder: v })}
            placeholder="Mortgage company"
          />
        </F>
      </div>
      <div className="sm:col-span-2">
        <F label="Balance owed today">
          <Money value={l.balance} onChange={(v) => set({ balance: v })} />
        </F>
      </div>
      {l.type === "heloc" && (
        <div className="sm:col-span-2">
          <F label="Credit limit">
            <Money value={l.limit} onChange={(v) => set({ limit: v })} />
          </F>
        </div>
      )}
      <div className="sm:col-span-2">
        <F label="Monthly payment" optional>
          <Money value={l.payment} onChange={(v) => set({ payment: v })} />
        </F>
      </div>
      <div className="sm:col-span-2">
        <F label="Payments">
          <Select value={l.status} onChange={(v) => set({ status: v })} options={PAYMENT_STATUS} />
        </F>
      </div>
      <div className="sm:col-span-3">
        <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">
          Late 30+ days in the last 12 months
        </p>
        <Choice
          label="Late payments in the last 12 months"
          value={l.late_12m as "0" | "1" | "2+" | ""}
          onChange={(v) => set({ late_12m: v })}
          options={[
            { id: "0", label: "Never" },
            { id: "1", label: "Once" },
            { id: "2+", label: "2+ times" },
          ]}
        />
      </div>
      <div className="sm:col-span-3">
        <p className="mb-1.5 text-[0.8rem] font-semibold text-smoke">
          Pay this off with new funding?
        </p>
        <Choice
          label="Pay off with new funding"
          value={l.payoff}
          onChange={(v) => set({ payoff: v })}
          options={YES_NO}
        />
      </div>
      {remove && (
        <button
          type="button"
          onClick={remove}
          className="inline-flex items-center gap-1.5 justify-self-start text-sm font-semibold text-smoke hover:text-ink sm:col-span-6"
        >
          <Trash2 className="size-4" /> Remove this balance
        </button>
      )}
    </div>
  );
}

/** Value, what's owed and what's left, as a bar: the number property-backed funding starts from. */
function EquityMeter({
  value,
  owed,
  equity,
  ratio,
  atLimits,
}: {
  value: number | null;
  owed: number;
  equity: number | null;
  ratio: number | null;
  /** What's owed if every equity line were drawn to its limit, when that's more. */
  atLimits: number | null;
}) {
  if (value == null || value <= 0) return null;
  const owedPct = Math.min(100, Math.max(0, (ratio ?? 0) * 100));
  return (
    <div className="mt-8 rounded-2xl bg-white p-5 ring-1 ring-line" data-equity-meter>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-smoke">Your estimated equity</p>
        <p className="font-display text-2xl font-bold tabular-nums text-forest">
          {usd0(equity != null ? Math.max(0, equity) : null)}
        </p>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="flex h-full">
          <div className="h-full bg-smoke/60" style={{ width: `${owedPct}%` }} />
          <div className="h-full flex-1 bg-leaf" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-smoke">
        <span>
          Owed {usd0(owed)} ({pct(ratio)} of value)
        </span>
        <span>Worth about {usd0(value)}</span>
      </div>
      {atLimits != null && (
        <p className="mt-2 text-xs text-smoke">
          With your equity line fully drawn: {usd0(atLimits)} owed ({pct(atLimits / value)} of
          value). Funding partners usually count the full line.
        </p>
      )}
    </div>
  );
}
