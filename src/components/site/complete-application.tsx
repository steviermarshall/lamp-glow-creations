import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import {
  cleanDetails,
  CONSENT_TEXT,
  CONSENT_VERSION,
  detailsToPdf,
  fromRow,
  missing,
  prefill,
  signatureMatches,
  type Details,
} from "@/lib/application-details";
import { applicationPdfBytes, downloadApplicationPdf } from "@/lib/application-pdf";
import {
  BusinessSection,
  FundingSection,
  OwnersSection,
  RealEstateSection,
  type Update,
} from "@/components/application/sections";
import { SignBlock } from "@/components/application/sign-block";
import { emptySigning, type Signing } from "@/components/application/form-kit";
import { ChangeForm } from "@/components/application/change-form";
import type { ChangeItem, ChangesSubmitResponse } from "@/lib/application-changes";

/**
 * The full application on the merchant's account page: business, owners, real estate, current
 * advances and the request, saved as a draft as often as they like, then signed once with their
 * typed name and drawn signature. The database stamps the signature time and refuses edits after
 * signing (application_details). The same sections as the application link page.
 * When their rep sends a signed application back for changes, it opens here again with what the
 * rep asked for, and they sign the update (a new version; the one they signed before is kept).
 * Merchant copy: never the word "loan".
 */

/** What my_application_changes returns: an open request, and the dates they signed. */
type Changes = {
  open: {
    id: string;
    items: ChangeItem[];
    message: string | null;
    base_version: number;
    asked_at: string;
  } | null;
  rep: { name: string | null } | null;
  versions: { version: number; signed_at: string }[];
};

type Row = {
  business: unknown;
  owners: unknown;
  balances: unknown;
  request: unknown;
  real_estate: unknown;
  signed_name: string | null;
  signed_at: string | null;
  signature_image: string | null;
  signed_name_2: string | null;
  signature_image_2: string | null;
  signed_via: string | null;
  consent_version: string | null;
  signer_ip: string | null;
  signer_agent: string | null;
};

type Signed = {
  name: string | null;
  at: string | null;
  image: string | null;
  name2: string | null;
  image2: string | null;
  via: "link" | "account" | null;
  consent: string | null;
  ip: string | null;
  agent: string | null;
};

const unsigned: Signed = {
  name: null,
  at: null,
  image: null,
  name2: null,
  image2: null,
  via: null,
  consent: null,
  ip: null,
  agent: null,
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
  const [signed, setSigned] = useState<Signed>(unsigned);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<"" | "draft" | "sign">("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sig, setSig] = useState<Signing>(emptySigning);
  const [repName, setRepName] = useState<string | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [updating, setUpdating] = useState(false);
  // bumped after an update is signed, to read everything again
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const [row, app, chg] = await Promise.all([
        sb
          .from("application_details")
          .select(
            "business,owners,balances,request,real_estate,signed_name,signed_at,signature_image,signed_name_2,signature_image_2,signed_via,consent_version,signer_ip,signer_agent",
          )
          .eq("application_id", applicationId)
          .maybeSingle(),
        sb
          .from("applications")
          .select("business_name,first_name,phone,email,answers,rep_slug")
          .eq("id", applicationId)
          .maybeSingle(),
        // not in the database yet (or a hiccup): the page works without it
        sb.rpc("my_application_changes", { _application_id: applicationId }),
      ]);
      if (!live) return;
      setChanges(chg.error ? null : ((chg.data as unknown as Changes | null) ?? null));
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
        setSigned({
          name: r.signed_name,
          at: r.signed_at,
          image: r.signature_image,
          name2: r.signed_name_2,
          image2: r.signature_image_2,
          via: r.signed_via === "link" || r.signed_via === "account" ? r.signed_via : null,
          consent: r.consent_version,
          ip: r.signer_ip,
          agent: r.signer_agent,
        });
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
  }, [applicationId, tick]);

  if (!d) return null;
  const todo = missing(d);
  const owner = d.owners[0]!;
  const update: Update = (fn) => setD((x) => (x ? fn(x) : x));

  const pdfSource = (x: Details) => ({
    answers: null,
    first_name: x.owners[0]?.first ?? null,
    business_name: x.business.legal_name,
    phone: x.business.phone,
    email: x.business.email,
    amount_requested: null,
    repName,
  });

  async function save(sign: boolean) {
    const sb = getSupabase();
    if (!sb || !d) return;
    setError("");
    const co = d.owners[1];
    // a second signer only counts while there is a second owner
    const second = sig.second && !!co;
    if (sign) {
      if (todo.length) return setError("Fill in everything listed above before signing.");
      if (!sig.agree) return setError("Tick the box to agree to the authorization.");
      if (!signatureMatches(sig.typed, owner))
        return setError(`Type your full name as the owner, ${owner.first} ${owner.last}, to sign.`);
      if (!sig.image) return setError("Draw your signature in the box.");
      if (second && co) {
        if (!signatureMatches(sig.typed2, co))
          return setError(`${co.first} types their full name, ${co.first} ${co.last}, to sign.`);
        if (!sig.image2) return setError(`${co.first} draws their signature in the box.`);
      }
    }
    setSaving(sign ? "sign" : "draft");
    const clean = cleanDetails(d);
    const payload = {
      business: clean.business,
      owners: clean.owners,
      balances: clean.balances,
      request: clean.request,
      real_estate: clean.real_estate,
      ...(sign
        ? {
            signed_name: sig.typed.trim(),
            signature_image: sig.image,
            signed_name_2: second ? sig.typed2.trim() : null,
            signature_image_2: second ? sig.image2 : null,
            consent_text: CONSENT_TEXT,
            consent_version: CONSENT_VERSION,
            signer_agent: navigator.userAgent.slice(0, 300),
          }
        : {}),
    };
    const cols =
      "signed_name,signed_at,signature_image,signed_name_2,signature_image_2,signed_via,consent_version,signer_ip,signer_agent";
    const res = exists
      ? await sb
          .from("application_details")
          .update(payload)
          .eq("application_id", applicationId)
          .select(cols)
          .single()
      : await sb
          .from("application_details")
          .insert({ application_id: applicationId, user_id: userId, ...payload })
          .select(cols)
          .single();
    setSaving("");
    if (res.error) {
      setError("Couldn't save. Check your connection and try again, or call your rep.");
      return;
    }
    setExists(true);
    setSavedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    const r = res.data as Pick<
      Row,
      | "signed_name"
      | "signed_at"
      | "signature_image"
      | "signed_name_2"
      | "signature_image_2"
      | "signed_via"
      | "consent_version"
      | "signer_ip"
      | "signer_agent"
    >;
    if (r.signed_at) {
      const s: Signed = {
        name: r.signed_name,
        at: r.signed_at,
        image: r.signature_image,
        name2: r.signed_name_2,
        image2: r.signature_image_2,
        via: r.signed_via === "link" ? "link" : "account",
        consent: r.consent_version,
        ip: r.signer_ip,
        agent: r.signer_agent,
      };
      setSigned(s);
      setOpen(false);
      if (sign) void storeSignedCopy(clean, s);
    }
  }

  /**
   * Keep the signed application with the merchant's documents, as the "signed funder
   * application" item. Funders get this file when Lamp sends the deal, including automatic
   * sends. Best effort: if it fails, the rep's Send builds the same PDF from the saved answers.
   */
  async function storeSignedCopy(x: Details, s: Signed) {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const bytes = await applicationPdfBytes(pdfSource(x), detailsToPdf(x, s, repName));
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
      // an update says which version it is and what it replaced
      const v = changes?.versions ?? [];
      await downloadApplicationPdf(
        pdfSource(d),
        detailsToPdf(
          d,
          { ...signed, version: v[0]?.version ?? null, replaces: v[1]?.signed_at ?? null },
          repName,
        ),
      );
    } catch {
      setError("Couldn't build your copy. Try again.");
    }
  }

  /** Signs the update through Lamp's server, which checks it's theirs and the request is open. */
  async function signUpdate(next: Details, s: Signing) {
    const sb = getSupabase();
    const open = changes?.open;
    if (!sb || !open) return;
    setUpdating(true);
    setError("");
    const session = (await sb.auth.getSession()).data.session;
    if (!session) {
      setUpdating(false);
      return setError("Sign in again to sign your update.");
    }
    const second = s.second && !!next.owners[1];
    try {
      const res = await fetch("/api/application/changes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "submit",
          request_id: open.id,
          base_version: open.base_version,
          details: next,
          signature: {
            name: s.typed.trim(),
            image: s.image,
            name2: second ? s.typed2.trim() : null,
            image2: second ? s.image2 : null,
          },
          consent_version: CONSENT_VERSION,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as Partial<ChangesSubmitResponse> & {
        error?: string;
        missing?: string[];
      };
      if (!res.ok) {
        setError(
          out.missing?.length
            ? `Still needed: ${out.missing.join(", ")}.`
            : (out.error ?? "Couldn't sign your update. Try again, or call your rep."),
        );
        return;
      }
      setTick((n) => n + 1);
    } catch {
      setError("Couldn't reach Lamp. Check your connection and try again.");
    } finally {
      setUpdating(false);
    }
  }

  if (signed.at && changes?.open) {
    return (
      <section className={cn(card, "p-6")} data-application="update">
        <h2 className="font-display text-lg font-semibold">Update your application</h2>
        <p className="mt-2 text-sm text-smoke">
          You signed it on{" "}
          {new Date(signed.at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          . Your rep needs one more thing before it goes further.
        </p>
        <div className="mt-6">
          <ChangeForm
            base={d}
            items={changes.open.items}
            message={changes.open.message}
            repName={changes.rep?.name ?? repName ?? "Your rep"}
            busy={updating}
            error={error}
            onSign={(next, s) => void signUpdate(next, s)}
            cta="Sign my update"
          />
        </div>
      </section>
    );
  }

  if (signed.at) {
    const updated = (changes?.versions.length ?? 0) > 1;
    return (
      <section className={cn(card, "p-6")} data-application="signed">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Check className="size-5 text-forest" /> Application signed
        </h2>
        <p className="mt-2 text-sm text-smoke">
          Signed by {signed.name}
          {signed.name2 ? ` and ${signed.name2}` : ""} on{" "}
          {new Date(signed.at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {updated ? " (updated)" : ""}. Your rep has it. To change anything now, call or text your
          rep.
        </p>
        {signed.image && (
          <div className="mt-4 inline-block rounded-xl bg-[#fbfaf5] px-4 py-2 ring-1 ring-black/10">
            <img
              src={signed.image}
              alt={`Signature of ${signed.name ?? "the owner"}`}
              className="h-12 w-auto"
            />
          </div>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div>
          <button type="button" className={cn(btnOutline, "mt-4 px-5 py-2.5")} onClick={copy}>
            Download my signed application
          </button>
        </div>
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
        <div className="mt-8 space-y-12">
          <BusinessSection d={d} update={update} />
          <OwnersSection d={d} update={update} />
          <RealEstateSection d={d} update={update} />
          <FundingSection d={d} update={update} />

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

          <div className="border-t border-line pt-8">
            <SignBlock
              d={d}
              s={sig}
              set={(patch) => setSig((x) => ({ ...x, ...patch }))}
              todo={todo}
              error={error}
              busy={saving === "sign"}
              onSign={() => void save(true)}
              cta="Sign my application"
            />
          </div>
        </div>
      )}
    </section>
  );
}
