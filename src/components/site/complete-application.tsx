import { useEffect, useState, type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  ENTITY_TYPES,
  USES,
  detailsToPdf,
  emptyBalance,
  emptyOwner,
  fromRow,
  missing,
  prefill,
  signatureMatches,
  type Balance,
  type Business,
  type Details,
  type Owner,
} from "@/lib/application-details";
import { applicationPdfBytes, downloadApplicationPdf } from "@/lib/application-pdf";

/**
 * The full application on the merchant's account page: business, owners, current advances and
 * the request, saved as a draft as often as they like, then signed once with their typed name.
 * The database stamps the signature time and refuses edits after signing (application_details).
 * Merchant copy: never the word "loan".
 */

const field = "w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-line focus:ring-ink/40";

type Row = {
  business: unknown;
  owners: unknown;
  balances: unknown;
  request: unknown;
  signed_name: string | null;
  signed_at: string | null;
};

export function CompleteApplication({
  applicationId,
  userId,
}: {
  applicationId: string;
  userId: string;
}) {
  const [d, setD] = useState<Details | null>(null);
  const [exists, setExists] = useState(false);
  const [signed, setSigned] = useState<{ name: string | null; at: string | null }>({
    name: null,
    at: null,
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<"" | "draft" | "sign">("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [agree, setAgree] = useState(false);
  const [repName, setRepName] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const [row, app] = await Promise.all([
        sb
          .from("application_details")
          .select("business,owners,balances,request,signed_name,signed_at")
          .eq("application_id", applicationId)
          .maybeSingle(),
        sb
          .from("applications")
          .select("business_name,first_name,phone,email,answers,rep_slug")
          .eq("id", applicationId)
          .maybeSingle(),
      ]);
      if (!live) return;
      const r = row.data as Row | null;
      const a = app.data as {
        business_name: string | null;
        first_name: string | null;
        phone: string | null;
        email: string | null;
        answers: { purpose?: string } | null;
        rep_slug: string | null;
      } | null;
      if (r) {
        setExists(true);
        setD(fromRow(r));
        setSigned({ name: r.signed_name, at: r.signed_at });
      } else {
        setD(
          prefill({
            business_name: a?.business_name ?? null,
            first_name: a?.first_name ?? null,
            phone: a?.phone ?? null,
            email: a?.email ?? null,
            purpose: a?.answers?.purpose ?? null,
          }),
        );
      }
      if (a?.rep_slug) {
        const rep = await sb.from("reps").select("name").eq("slug", a.rep_slug).maybeSingle();
        if (live) setRepName((rep.data as { name: string } | null)?.name ?? null);
      }
    })();
    return () => {
      live = false;
    };
  }, [applicationId]);

  if (!d) return null;
  const todo = missing(d);
  const owner = d.owners[0]!;

  const setB = (k: keyof Business, v: string) =>
    setD({ ...d, business: { ...d.business, [k]: v } });
  const setO = (i: number, k: keyof Owner, v: string) =>
    setD({ ...d, owners: d.owners.map((o, j) => (j === i ? { ...o, [k]: v } : o)) });
  const setBal = (i: number, k: keyof Balance, v: string) =>
    setD({ ...d, balances: d.balances.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });

  async function save(sign: boolean) {
    const sb = getSupabase();
    if (!sb || !d) return;
    setError("");
    if (sign) {
      if (todo.length) return setError("Fill in everything listed above before signing.");
      if (!agree) return setError("Tick the box to agree to the authorization.");
      if (!signatureMatches(typed, owner))
        return setError(`Type your full name as the owner, ${owner.first} ${owner.last}, to sign.`);
    }
    setSaving(sign ? "sign" : "draft");
    const payload = {
      business: d.business,
      owners: d.owners,
      balances: d.balances.filter((b) => b.funder.trim() || b.current.trim()),
      request: d.request,
      ...(sign
        ? {
            signed_name: typed.trim(),
            consent_text: CONSENT_TEXT,
            consent_version: CONSENT_VERSION,
            signer_agent: navigator.userAgent.slice(0, 300),
          }
        : {}),
    };
    const res = exists
      ? await sb
          .from("application_details")
          .update(payload)
          .eq("application_id", applicationId)
          .select("signed_name,signed_at")
          .single()
      : await sb
          .from("application_details")
          .insert({ application_id: applicationId, user_id: userId, ...payload })
          .select("signed_name,signed_at")
          .single();
    setSaving("");
    if (res.error) {
      setError("Couldn't save. Check your connection and try again, or call your rep.");
      return;
    }
    setExists(true);
    setSavedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    const r = res.data as { signed_name: string | null; signed_at: string | null };
    if (r.signed_at) {
      setSigned({ name: r.signed_name, at: r.signed_at });
      setOpen(false);
      if (sign) void storeSignedCopy({ name: r.signed_name, at: r.signed_at });
    }
  }

  /**
   * Keep the signed application with the merchant's documents, as the "signed funder
   * application" item. Funders get this file when Lamp sends the deal, including automatic
   * sends. Best effort: if it fails, the rep's Send builds the same PDF from the saved answers.
   */
  async function storeSignedCopy(sig: { name: string | null; at: string | null }) {
    const sb = getSupabase();
    if (!sb || !d) return;
    try {
      const bytes = await applicationPdfBytes(
        {
          answers: null,
          first_name: owner.first,
          business_name: d.business.legal_name,
          phone: d.business.phone,
          email: d.business.email,
          amount_requested: null,
          repName,
        },
        detailsToPdf(d, sig, repName),
      );
      const path = `${userId}/${Date.now()}-signed-application.pdf`;
      const up = await sb.storage
        .from("documents")
        .upload(path, new Blob([bytes as BlobPart], { type: "application/pdf" }), {
          upsert: false,
        });
      if (up.error) return;
      const idx = await sb.from("documents").insert({
        application_id: applicationId,
        user_id: userId,
        bucket: "documents",
        storage_path: path,
        kind: "funder_application",
        original_name: "Signed application.pdf",
        size_bytes: bytes.length,
        mime_type: "application/pdf",
      });
      if (idx.error) await sb.storage.from("documents").remove([path]);
    } catch {
      /* the staff Send builds it from the saved answers instead */
    }
  }

  async function copy() {
    if (!d) return;
    try {
      await downloadApplicationPdf(
        {
          answers: null,
          first_name: owner.first,
          business_name: d.business.legal_name,
          phone: d.business.phone,
          email: d.business.email,
          amount_requested: null,
          repName,
        },
        detailsToPdf(d, signed, repName),
      );
    } catch {
      setError("Couldn't build your copy. Try again.");
    }
  }

  if (signed.at) {
    return (
      <section className={cn(card, "p-6")} data-application="signed">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Check className="size-5 text-amber-deep" /> Application signed
        </h2>
        <p className="mt-2 text-sm text-smoke">
          Signed by {signed.name} on{" "}
          {new Date(signed.at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          . Your rep has it. To change anything now, call or text your rep.
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <button type="button" className={cn(btnOutline, "mt-4 px-5 py-2.5")} onClick={copy}>
          Download my signed application
        </button>
      </section>
    );
  }

  return (
    <section className={cn(card, "p-6")} data-application="open">
      <h2 className="font-display text-lg font-semibold">Complete and sign your application</h2>
      <p className="mt-2 text-sm text-smoke">
        Funders need the full application before they can make an offer. It takes about ten minutes.
        Save as you go and come back any time.
      </p>
      {!open ? (
        <button
          type="button"
          className={cn(btnPrimary, "mt-4 px-5 py-2.5")}
          onClick={() => setOpen(true)}
        >
          {exists ? "Continue my application" : "Start my application"}
        </button>
      ) : (
        <div className="mt-5 space-y-6">
          <Group title="Your business">
            <F label="Legal business name">
              <input
                className={field}
                value={d.business.legal_name}
                onChange={(e) => setB("legal_name", e.target.value)}
              />
            </F>
            <F label="Doing business as (if different)">
              <input
                className={field}
                value={d.business.dba}
                onChange={(e) => setB("dba", e.target.value)}
              />
            </F>
            <F label="Business address (no PO boxes)" wide>
              <input
                className={field}
                value={d.business.address}
                onChange={(e) => setB("address", e.target.value)}
              />
            </F>
            <F label="City">
              <input
                className={field}
                value={d.business.city}
                onChange={(e) => setB("city", e.target.value)}
              />
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="State">
                <input
                  className={field}
                  maxLength={2}
                  value={d.business.state}
                  onChange={(e) => setB("state", e.target.value.toUpperCase())}
                />
              </F>
              <F label="ZIP">
                <input
                  className={field}
                  inputMode="numeric"
                  maxLength={5}
                  value={d.business.zip}
                  onChange={(e) => setB("zip", e.target.value)}
                />
              </F>
            </div>
            <F label="Business phone">
              <input
                className={field}
                type="tel"
                value={d.business.phone}
                onChange={(e) => setB("phone", e.target.value)}
              />
            </F>
            <F label="Business email">
              <input
                className={field}
                type="email"
                value={d.business.email}
                onChange={(e) => setB("email", e.target.value)}
              />
            </F>
            <F label="Business start date">
              <input
                className={field}
                type="date"
                value={d.business.start_date}
                onChange={(e) => setB("start_date", e.target.value)}
              />
            </F>
            <F label="Federal tax ID (EIN)">
              <input
                className={field}
                inputMode="numeric"
                placeholder="12-3456789"
                value={d.business.ein}
                onChange={(e) => setB("ein", e.target.value)}
              />
            </F>
            <F label="Entity type">
              <select
                className={field}
                value={d.business.entity_type}
                onChange={(e) => setB("entity_type", e.target.value)}
              >
                <option value="">Choose one</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </F>
            <F label="Industry">
              <input
                className={field}
                value={d.business.industry}
                onChange={(e) => setB("industry", e.target.value)}
              />
            </F>
            <F label="Average monthly revenue ($)">
              <input
                className={field}
                inputMode="decimal"
                value={d.business.monthly_revenue}
                onChange={(e) => setB("monthly_revenue", e.target.value)}
              />
            </F>
            <F label="Monthly card sales ($, if any)">
              <input
                className={field}
                inputMode="decimal"
                value={d.business.card_volume}
                onChange={(e) => setB("card_volume", e.target.value)}
              />
            </F>
            <F label="Business bank">
              <input
                className={field}
                value={d.business.bank}
                onChange={(e) => setB("bank", e.target.value)}
              />
            </F>
            <F label="Deposits a month (count)">
              <input
                className={field}
                inputMode="numeric"
                value={d.business.deposit_count}
                onChange={(e) => setB("deposit_count", e.target.value)}
              />
            </F>
            <F label="Do you own or rent your location?">
              <select
                className={field}
                value={d.business.premises}
                onChange={(e) => setB("premises", e.target.value)}
              >
                <option value="">Choose one</option>
                <option value="own">Own</option>
                <option value="rent">Rent</option>
              </select>
            </F>
            {d.business.premises === "rent" && (
              <F label="Monthly rent ($)">
                <input
                  className={field}
                  inputMode="decimal"
                  value={d.business.rent}
                  onChange={(e) => setB("rent", e.target.value)}
                />
              </F>
            )}
            <F label="Any liens or judgments?">
              <select
                className={field}
                value={d.business.liens}
                onChange={(e) => setB("liens", e.target.value)}
              >
                <option value="">Choose one</option>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </F>
          </Group>

          {d.owners.map((o, i) => (
            <Group key={i} title={i === 0 ? "You (principal owner)" : "Second owner"}>
              <F label="First name">
                <input
                  className={field}
                  value={o.first}
                  onChange={(e) => setO(i, "first", e.target.value)}
                />
              </F>
              <F label="Last name">
                <input
                  className={field}
                  value={o.last}
                  onChange={(e) => setO(i, "last", e.target.value)}
                />
              </F>
              <F label="Title">
                <input
                  className={field}
                  placeholder="Owner, CEO…"
                  value={o.title}
                  onChange={(e) => setO(i, "title", e.target.value)}
                />
              </F>
              <F label="Ownership %">
                <input
                  className={field}
                  inputMode="decimal"
                  value={o.ownership}
                  onChange={(e) => setO(i, "ownership", e.target.value)}
                />
              </F>
              <F label="Home address" wide>
                <input
                  className={field}
                  value={o.address}
                  onChange={(e) => setO(i, "address", e.target.value)}
                />
              </F>
              <F label="City">
                <input
                  className={field}
                  value={o.city}
                  onChange={(e) => setO(i, "city", e.target.value)}
                />
              </F>
              <div className="grid grid-cols-2 gap-3">
                <F label="State">
                  <input
                    className={field}
                    maxLength={2}
                    value={o.state}
                    onChange={(e) => setO(i, "state", e.target.value.toUpperCase())}
                  />
                </F>
                <F label="ZIP">
                  <input
                    className={field}
                    inputMode="numeric"
                    maxLength={5}
                    value={o.zip}
                    onChange={(e) => setO(i, "zip", e.target.value)}
                  />
                </F>
              </div>
              <F label="Mobile phone">
                <input
                  className={field}
                  type="tel"
                  value={o.mobile}
                  onChange={(e) => setO(i, "mobile", e.target.value)}
                />
              </F>
              <F label="Email">
                <input
                  className={field}
                  type="email"
                  value={o.email}
                  onChange={(e) => setO(i, "email", e.target.value)}
                />
              </F>
              <F label="Date of birth">
                <input
                  className={field}
                  type="date"
                  value={o.dob}
                  onChange={(e) => setO(i, "dob", e.target.value)}
                />
              </F>
              <F label="Social Security number">
                <input
                  className={field}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="123-45-6789"
                  value={o.ssn}
                  onChange={(e) => setO(i, "ssn", e.target.value)}
                />
              </F>
              <F label="Credit score (your best guess)">
                <input
                  className={field}
                  inputMode="numeric"
                  value={o.credit}
                  onChange={(e) => setO(i, "credit", e.target.value)}
                />
              </F>
              {i === 1 && (
                <button
                  type="button"
                  className="self-end text-sm font-semibold text-smoke underline"
                  onClick={() => setD({ ...d, owners: d.owners.slice(0, 1) })}
                >
                  Remove second owner
                </button>
              )}
            </Group>
          ))}
          {d.owners.length < 2 && (
            <button
              type="button"
              className="text-sm font-semibold text-amber-deep underline"
              onClick={() => setD({ ...d, owners: [...d.owners, emptyOwner()] })}
            >
              Add a second owner (anyone with 20% or more)
            </button>
          )}

          <Group
            title="Current advances or balances"
            hint="Any funding you're paying back now. Leave empty if none."
          >
            {d.balances.map((b, i) => (
              <div
                key={i}
                className="grid gap-3 rounded-xl bg-sand p-3 sm:col-span-2 sm:grid-cols-5"
              >
                <F label="Funding company">
                  <input
                    className={field}
                    value={b.funder}
                    onChange={(e) => setBal(i, "funder", e.target.value)}
                  />
                </F>
                <F label="Original amount">
                  <input
                    className={field}
                    value={b.original}
                    onChange={(e) => setBal(i, "original", e.target.value)}
                  />
                </F>
                <F label="Balance now">
                  <input
                    className={field}
                    value={b.current}
                    onChange={(e) => setBal(i, "current", e.target.value)}
                  />
                </F>
                <F label="Daily or weekly payment">
                  <input
                    className={field}
                    value={b.payment}
                    onChange={(e) => setBal(i, "payment", e.target.value)}
                  />
                </F>
                <F label="Expected payoff">
                  <input
                    className={field}
                    value={b.payoff}
                    onChange={(e) => setBal(i, "payoff", e.target.value)}
                  />
                </F>
              </div>
            ))}
            {d.balances.length < 2 && (
              <button
                type="button"
                className="text-left text-sm font-semibold text-amber-deep underline sm:col-span-2"
                onClick={() => setD({ ...d, balances: [...d.balances, emptyBalance()] })}
              >
                Add a current advance
              </button>
            )}
          </Group>

          <Group title="What you're asking for">
            <F label="Amount requested ($)">
              <input
                className={field}
                inputMode="decimal"
                value={d.request.amount}
                onChange={(e) => setD({ ...d, request: { ...d.request, amount: e.target.value } })}
              />
            </F>
            <F label="Preferred term">
              <select
                className={field}
                value={d.request.term}
                onChange={(e) =>
                  setD({
                    ...d,
                    request: { ...d.request, term: e.target.value as Details["request"]["term"] },
                  })
                }
              >
                <option value="">No preference</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="9">9 months</option>
                <option value="12">12 months or more</option>
              </select>
            </F>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs font-semibold text-smoke">What it's for</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {USES.map((u) => (
                  <label key={u.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.request.uses.includes(u.id)}
                      onChange={(e) =>
                        setD({
                          ...d,
                          request: {
                            ...d.request,
                            uses: e.target.checked
                              ? [...d.request.uses, u.id]
                              : d.request.uses.filter((x) => x !== u.id),
                          },
                        })
                      }
                    />
                    {u.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </Group>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={cn(btnOutline, "px-5 py-2.5")}
              disabled={saving !== ""}
              onClick={() => save(false)}
            >
              {saving === "draft" ? "Saving…" : "Save and finish later"}
            </button>
            {savedAt && <span className="text-sm text-smoke">Saved at {savedAt}</span>}
          </div>

          <div className="rounded-2xl bg-sand p-5" data-sign>
            <h3 className="font-display text-base font-semibold">Sign</h3>
            {todo.length > 0 ? (
              <p className="mt-2 text-sm text-smoke">
                Still needed before you can sign: {todo.join(", ")}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-smoke">
                Everything's filled in. Read the authorization, then sign.
              </p>
            )}
            <div className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-white p-4 text-xs leading-relaxed text-smoke ring-1 ring-line">
              {CONSENT_TEXT}
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              I have read and agree to the authorization above, and the information in this
              application is true and complete.
            </label>
            <F label="Type your full name to sign">
              <input
                className={cn(field, "mt-1 font-semibold")}
                placeholder={`${owner.first} ${owner.last}`.trim() || "Your full name"}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </F>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <button
              type="button"
              className={cn(btnPrimary, "mt-4 px-5 py-2.5")}
              disabled={saving !== "" || todo.length > 0}
              onClick={() => save(true)}
            >
              {saving === "sign" ? "Signing…" : "Sign my application"}
            </button>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-smoke">
              <Lock className="size-3.5" /> Only you and the Lamp team can see this. Your SSN is
              used only to submit your application to funding partners.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="font-display text-base font-semibold">{title}</legend>
      {hint && <p className="mt-1 text-sm text-smoke">{hint}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function F({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={wide ? "block sm:col-span-2" : "block"}>
      <span className="mb-1 block text-xs font-semibold text-smoke">{label}</span>
      {children}
    </label>
  );
}
