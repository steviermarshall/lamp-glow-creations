import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { visitHeaders } from "@/lib/visit-headers";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileText,
  Loader2,
  Lock,
  Copy,
  Mail,
  Phone,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { saveSignedCopy } from "@/lib/signed-copy";
import { findRep, GOOGLE_SIGN_IN } from "@/lib/site";
import {
  cleanDetails,
  CONSENT_VERSION,
  detailsToPdf,
  emptyDetails,
  fromRow,
  FUNDING_GAPS,
  missing,
  signatureMatches,
  withQuickAnswers,
  type Details,
} from "@/lib/application-details";
import { missingRealEstate, usd0, amount } from "@/lib/real-estate";
import {
  applicationPdfBytes,
  downloadApplicationPdf,
  warmApplicationPdf,
} from "@/lib/application-pdf-lazy";
import {
  EMAIL_RE,
  inviteSms,
  MAX_UPLOAD_BYTES,
  saveClaim,
  UPLOAD_TYPES,
  type OpenResponse,
  type SubmitResponse,
} from "@/lib/application-links";
import { btnOutline, btnPrimary, Eyebrow } from "@/components/site/layout";
import { GoogleButton, sendMagicLink, signInWithGoogle } from "@/components/site/auth";
import {
  BusinessSection,
  FundingSection,
  OwnersSection,
  RealEstateSection,
  type Update,
} from "@/components/application/sections";
import { SignBlock } from "@/components/application/sign-block";
import { emptySigning, uploadType, type Signing } from "@/components/application/form-kit";
import { F, inputCls, Text } from "@/components/application/fields";
import { getSupabase } from "@/lib/supabase";
import {
  cleanChoices,
  estimate,
  funnelStep,
  labelFor,
  money,
  PHONE_CONSENT_TEXT,
  QUESTIONS,
  type ChoiceKey,
} from "@/lib/apply";
import { QuickQuestion } from "@/components/site/quick-question";
import { reportStage, saveProgressToken } from "@/lib/application-progress";
import { track } from "@/lib/track";
import {
  applicationPath,
  countWord,
  firstPaint,
  openRequest,
  pickSaved,
  quickOptionHref,
  resumeAt,
  STATEMENT_MONTHS,
  stepTracked,
  WEBSITE_OPEN,
  withThisBrowser,
  type Saved,
} from "@/lib/application-resume";
import { fetchStart, retryKeptStart, sendStart, tabStorage } from "@/lib/start-retry";

/**
 * The full application from a link: getlamp.app/application/<rep>?i=<token> (a personal link a
 * rep sent, with what they know filled in) or getlamp.app/application/<rep> (the rep's public
 * link). Six steps, saved in this browser as they go (never the SSN or date of birth), then the
 * merchant signs and submits without an account. The signed file lands with the rep; then they
 * can create a login to follow it, and the file moves into that account.
 * Merchant copy: never the word "loan".
 *
 * Start application (?fill=rep, from a lead's page in the back office): the rep fills the
 * merchant's personal link in with them on the phone. The answers save to the link on Lamp's
 * server as they go (never the SSN or date of birth, which only the merchant types), so the
 * merchant's own browser opens them. The rep never signs: the last step emails that same link to
 * the merchant, or copies it to text, and the merchant checks it, adds those numbers and signs.
 */

const STEPS = [
  { id: "business", title: "Business" },
  { id: "owners", title: "Owners" },
  { id: "property", title: "Real estate" },
  { id: "funding", title: "Funding" },
  { id: "statements", title: "Statements" },
  { id: "sign", title: "Review and sign" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const MAX_FILES = 8;

export type Done = SubmitResponse & { uploads: { name: string; ok: boolean; error?: string }[] };

/** Which step each missing answer belongs to, by the wording missing() uses. */
function missingByStep(d: Details): Record<StepId, string[]> {
  const out: Record<StepId, string[]> = {
    business: [],
    owners: [],
    property: [],
    funding: [],
    statements: [],
    sign: [],
  };
  const re = new Set(missingRealEstate(d.real_estate));
  for (const m of missing(d)) {
    if (re.has(m)) out.property.push(m);
    else if (/^(second )?owner's/.test(m)) out.owners.push(m);
    else if ((FUNDING_GAPS as readonly string[]).includes(m)) out.funding.push(m);
    else out.business.push(m);
  }
  return out;
}

/**
 * Saved in this browser between visits: the answers without SSNs or dates of birth. A personal
 * link keys it by the invite (the same across a resent link), a public link by the rep.
 */
const draftKey = (invite: string | null | undefined, rep: string) =>
  invite ? `lamp.application.draft.${invite}` : `lamp.application.draft.rep.${rep}`;

function loadDraft(key: string): Saved<Details> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { d?: unknown; step?: unknown; savedAt?: unknown };
    return {
      d: fromRow((v.d ?? {}) as Record<string, unknown>),
      step: typeof v.step === "number" ? Math.min(Math.max(0, v.step), STEPS.length - 1) : 0,
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function saveDraft(key: string, d: Details, step: number) {
  try {
    const safe = { ...d, owners: d.owners.map((o) => ({ ...o, ssn: "", dob: "" })) };
    window.localStorage.setItem(key, JSON.stringify({ d: safe, step, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the page still works in memory */
  }
}

/** The SSN and date of birth: only the merchant types them, when they sign. */
export const PRIVATE_GAP = /SSN|date of birth/;

/** POST /api/application/draft as the signed-in rep. Throws with the server's words. */
export async function postDraft(body: object): Promise<Record<string, unknown>> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in to Lamp in this browser so this saves for them.");
  const res = await fetch("/api/application/draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data["error"] ?? `The server answered ${res.status}.`));
  return data;
}

function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function LinkApplication({
  repSlug,
  token,
  filling = false,
  prefill = {},
  carried = {},
}: {
  /** "" is the website's own application (getlamp.app/application): no rep, the file is unassigned. */
  repSlug: string;
  token: string | null;
  /** A rep filling it in with the merchant on the phone (Start application). */
  filling?: boolean;
  /** Quick answers from the link (?amount=50-100k&industry=trucking): those questions are skipped. */
  prefill?: Partial<Record<ChoiceKey, string>>;
  /** The quick answers and utm_ tags in the address, kept on the quick-question links. */
  carried?: Record<string, string>;
}) {
  // only a personal link can be filled in for someone
  const phoneMode = filling && Boolean(token);
  const website = !token && repSlug === "";
  // what this browser keeps between visits is keyed by the rep, or by "website"
  const store = website ? "website" : repSlug;
  const [synced, setSynced] = useState<{ at: string } | { error: string } | null>(null);
  // the website's answer is always the same, so its page renders on the server without asking
  const [open, setOpen] = useState<OpenResponse | "error" | null>(website ? WEBSITE_OPEN : null);
  const [d, setD] = useState<Details>(emptyDetails);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sig, setSig] = useState<Signing>(emptySigning);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  // The first render is the server's, so it uses only what the link says: a public link asks for
  // name, phone and email first (a personal link already knows who it's for), after the front
  // page's quick questions, one tap each. This browser's own answers are merged in after mount.
  const [first] = useState(() => firstPaint(token, prefill));
  const [contactDone, setContactDone] = useState(first.contactDone);
  const [quick, setQuick] = useState<Partial<Record<ChoiceKey, string>>>(first.quick);
  const [quickStep, setQuickStep] = useState(first.quickStep);
  // set once this browser's saved place is back, so the drop-off count never logs a stray step
  const [restored, setRestored] = useState(false);
  // after the contact screen on a public link: the rough range from their answers, once
  const [showRange, setShowRange] = useState(false);
  const started = useRef(false);
  const topRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // what was signed, kept for the download button on the done screen
  const lastSigned = useRef<{
    src: Parameters<typeof downloadApplicationPdf>[0];
    values: Parameters<typeof downloadApplicationPdf>[1];
  } | null>(null);
  const key = draftKey(open && open !== "error" ? open.draft : null, store);

  // the application is always the light look (the head script does it on a fresh load; this
  // covers arriving here from another page of the site)
  useEffect(() => {
    document.documentElement.dataset["theme"] = "light";
  }, []);

  // the PDF builder arrives in the background, so it is there by the time they sign
  useEffect(() => warmApplicationPdf(), []);

  /**
   * Reopen this browser's saved answers (or a rep's newer phone answers) on the step they left,
   * or fill in what the rep already knows. Runs once the link is known to be open: at mount for
   * the website, after the open call for a link.
   */
  const restoreSaved = (o: OpenResponse) => {
    const local = loadDraft(draftKey(o.draft, store));
    // answers a rep filled in on the phone, when they're newer than this browser's own
    const server = o.answers
      ? {
          d: fromRow(o.answers),
          step: Math.min(Math.max(0, o.answers_step ?? 0), STEPS.length - 1),
          savedAt: o.answers_saved_at ? Date.parse(o.answers_saved_at) : 0,
        }
      : null;
    const saved = pickSaved(local, server);
    if (saved) {
      setContactDone(true);
      // reopen on the first step with gaps (the SSN and date of birth are never saved), and
      // keep the later steps reachable
      const gaps = missingByStep(saved.d);
      const at = resumeAt(
        saved.step,
        STEPS.findIndex((x) => gaps[x.id].length > 0),
      );
      setD(saved.d);
      setStep(at.step);
      setVisited(at.visited);
      return;
    }
    const p = o.prefill;
    if (p) {
      setD((x) => ({
        ...x,
        business: {
          ...x.business,
          legal_name: p.business_name,
          phone: p.phone,
          email: p.email,
        },
        owners: [
          {
            ...x.owners[0]!,
            first: p.first_name,
            last: p.last_name,
            email: p.email,
            mobile: p.phone,
          },
          ...x.owners.slice(1),
        ],
      }));
    }
  };

  useEffect(() => {
    // this browser's quick answers and contact, kept from an earlier visit (the link's answers win)
    const here = withThisBrowser(first, prefill, loadQuick(store), !token && hasStarted(store));
    setQuick(here.quick);
    setQuickStep(here.quickStep);
    setContactDone(here.contactDone);
    // the website asks nothing: its answer is WEBSITE_OPEN, so this browser's place comes back now
    const ask = openRequest(token, repSlug);
    if (!ask) {
      setOpen(WEBSITE_OPEN);
      restoreSaved(WEBSITE_OPEN);
      setRestored(true);
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/application/open", {
          method: "POST",
          headers: await visitHeaders(),
          body: JSON.stringify(ask),
        });
        const o = (await res.json().catch(() => null)) as OpenResponse | null;
        if (!live) return;
        if (!res.ok || !o || typeof o.state !== "string") {
          setOpen("error");
          return;
        }
        setOpen(o);
        if (o.state === "open") restoreSaved(o);
        setRestored(true);
      } catch {
        if (live) setOpen("error");
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store follows repSlug; prefill is the first render's
  }, [token, repSlug]);

  // a contact save that never got the server's answer gets its last try when the visitor moves
  // on (see start-retry); never on a personal link, which has no contact screen. furthest is the
  // step they have reached: the stage report sent before this try's token arrived was skipped
  // (reportStage needs the token), so a save that lands now reports it itself.
  const retryStart = (furthest = 0) => {
    if (token) return;
    void retryKeptStart({ send: fetchStart, storage: tabStorage(), store }).then((r) => {
      if (!r?.progress) return;
      saveProgressToken(store, r.progress);
      if (furthest > 0)
        reportStage(store, STEPS[furthest]!.id as Exclude<StepId, "business">, "online");
    });
  };

  const update: Update = (fn) => {
    setD((x) => {
      const next = fn(x);
      saveDraft(key, next, step);
      return next;
    });
    if (token && !started.current) {
      started.current = true;
      void visitHeaders()
        .then((headers) =>
          fetch("/api/application/open", {
            method: "POST",
            headers,
            body: JSON.stringify({ token, event: "start" }),
          }),
        )
        .catch(() => undefined);
    }
  };

  const allByStep = useMemo(() => missingByStep(d), [d]);
  // on the phone the rep moves on without the SSN and date of birth: the merchant adds them
  const byStep = useMemo(
    () =>
      phoneMode
        ? (Object.fromEntries(
            Object.entries(allByStep).map(([k, v]) => [k, v.filter((m) => !PRIVATE_GAP.test(m))]),
          ) as Record<StepId, string[]>)
        : allByStep,
    [allByStep, phoneMode],
  );

  // on the phone, every change saves to the link on Lamp's server, a moment after typing stops
  useEffect(() => {
    if (!phoneMode || !token || !open || open === "error" || open.state !== "open") return;
    if (!contactDone) return;
    const t = window.setTimeout(() => {
      const safe = { ...d, owners: d.owners.map((o) => ({ ...o, ssn: "", dob: "" })) };
      postDraft({ action: "save", token, draft: safe, step })
        .then((r) => setSynced({ at: String(r["saved_at"] ?? new Date().toISOString()) }))
        .catch((e: unknown) =>
          setSynced({ error: e instanceof Error ? e.message : "Couldn't save to Lamp." }),
        );
    }, 1200);
    return () => window.clearTimeout(t);
  }, [d, step, phoneMode, token, open, contactDone]);
  // a public application's drop-off, step by step, for the staff dashboard (staff browsers are
  // left out by track itself); only once this browser's saved place is back, so a returning
  // visitor isn't logged at the first question on the way to their own step
  useEffect(() => {
    if (!stepTracked(token, restored, open)) return;
    track(
      "apply_step",
      funnelStep({ quickStep, contactDone, showRange, part: step, signed: Boolean(done) }),
    );
  }, [token, restored, open, quickStep, contactDone, showRange, step, done]);

  const allMissing = useMemo(() => missing(d), [d]);
  const current = STEPS[step]!;
  const rep = open && open !== "error" ? open.rep : null;
  const repName = rep?.name ?? (website ? "the Lamp team" : "your Lamp rep");
  const repFirst = rep ? (rep.name.split(" ")[0] ?? rep.name) : website ? "Lamp" : "your rep";

  const lastStep = STEPS.length - 1;

  const go = (to: number) => {
    // leaving the sign step drops the drawings: the pad comes back blank, so must the state
    if (current.id === "sign" && to !== step) setSig((x) => ({ ...x, image: null, image2: null }));
    setStep(to);
    setVisited((v) => Math.max(v, to));
    retryStart(Math.min(Math.max(visited, to), lastStep));
    // a public link's lead: the furthest step reached (the server keeps the furthest)
    if (!token && to > 0)
      reportStage(store, STEPS[to]!.id as Exclude<StepId, "business">, "online");
    setShowMissing(false);
    saveDraft(key, d, to);
    window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      headingRef.current?.focus({ preventScroll: true });
    });
  };

  /** Continue, or (after a Review edit) straight back to signing; blocked while gaps remain. */
  const next = (to = step + 1) => {
    if (byStep[current.id].length) {
      setShowMissing(true);
      window.requestAnimationFrame(() =>
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
      return;
    }
    go(to);
  };

  async function submit() {
    setError("");
    const owner = d.owners[0]!;
    if (allMissing.length) return setError("Fill in everything listed above before signing.");
    if (!sig.agree) return setError("Tick the box to agree to the authorization.");
    if (!signatureMatches(sig.typed, owner))
      return setError(`Type your full name as the owner, ${owner.first} ${owner.last}, to sign.`);
    if (!sig.image) return setError("Draw your signature in the box.");
    const co = d.owners[1];
    const second = sig.second && !!co;
    if (second && co) {
      if (!signatureMatches(sig.typed2, co))
        return setError(`${co.first} types their full name, ${co.first} ${co.last}, to sign.`);
      if (!sig.image2) return setError(`${co.first} draws their signature in the box.`);
    }
    setBusy(true);
    const clean = cleanDetails(d);
    const signed = {
      name: sig.typed.trim(),
      at: new Date().toISOString(),
      image: sig.image,
      name2: second ? sig.typed2.trim() : null,
      image2: second ? sig.image2 : null,
      via: "link" as const,
      ip: null,
      agent: navigator.userAgent,
      consent: CONSENT_VERSION,
    };
    const src = {
      answers: null,
      first_name: owner.first,
      business_name: clean.business.legal_name,
      phone: clean.business.phone,
      email: owner.email,
      amount_requested: amount(clean.request.amount),
      repName: rep?.name ?? null,
    };
    let res: Response;
    try {
      res = await fetch("/api/application/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          rep: token ? undefined : repSlug,
          details: clean,
          signature: {
            name: signed.name,
            image: signed.image,
            name2: signed.name2,
            image2: signed.image2,
          },
          consent_version: CONSENT_VERSION,
        }),
      });
    } catch {
      setBusy(false);
      return setError("Couldn't reach Lamp. Check your connection and try again.");
    }
    const out = (await res.json().catch(() => ({}))) as Partial<SubmitResponse> & {
      error?: string;
      missing?: string[];
    };
    if (!res.ok || !out.application_id || !out.claim_token) {
      setBusy(false);
      return setError(
        out.missing?.length
          ? `Still needed: ${out.missing.join(", ")}.`
          : (out.error ?? "Couldn't submit. Try again, or call your rep."),
      );
    }
    saveClaim(out.claim_token);
    clearDraft(key);

    // The signed PDF, built now with what the database stamped (time and IP), goes with the
    // file for funders. If building or sending it fails, staff build the same PDF later.
    const stamped = { ...signed, at: out.signed_at ?? signed.at, ip: out.signer_ip ?? null };
    const values = detailsToPdf(clean, stamped);
    lastSigned.current = { src, values };
    const upload = async (
      blob: Blob,
      name: string,
      kind: "bank_statement" | "funder_application",
    ) => {
      const form = new FormData();
      form.set("application_id", out.application_id!);
      form.set("claim_token", out.claim_token!);
      form.set("kind", kind);
      form.set("file", blob, name);
      const up = await fetch("/api/application/upload", { method: "POST", body: form });
      const j = (await up.json().catch(() => ({}))) as { error?: string };
      return up.ok ? null : (j.error ?? "Didn't upload");
    };
    // two tries, and what went wrong goes on the file's timeline (see signed-copy.ts)
    const copyError = await saveSignedCopy(
      () => applicationPdfBytes(src, values, "lender"),
      (bytes) =>
        upload(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          "Signed application.pdf",
          "funder_application",
        ),
    );

    const uploads: Done["uploads"] = [];
    for (const f of files) {
      setUploading(f.name);
      try {
        const err = await upload(f, f.name, "bank_statement");
        uploads.push(err ? { name: f.name, ok: false, error: err } : { name: f.name, ok: true });
      } catch {
        uploads.push({ name: f.name, ok: false, error: "Didn't upload" });
      }
    }
    setUploading(null);
    // Now the rep (and Asad and Stevie) get the email, with the signed copy and the statements
    // attached. Best effort: the file is on the rep's board either way.
    try {
      await fetch("/api/application/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: out.application_id,
          claim_token: out.claim_token,
          ...(copyError ? { copy_error: copyError } : {}),
        }),
      });
    } catch {
      /* the file shows as Signed on the rep's Applications tab */
    }
    setBusy(false);
    setDone({
      application_id: out.application_id,
      claim_token: out.claim_token,
      rep_name: out.rep_name ?? rep?.name ?? "",
      email: out.email ?? owner.email,
      signed_at: stamped.at,
      signer_ip: stamped.ip,
      uploads,
    });
    window.scrollTo({ top: 0 });
  }
  // the page shell (PageShell) is the route's, so its code is in the route's own preload list
  return (
    <>
      <div ref={topRef} className="mx-auto max-w-3xl scroll-mt-24 px-4 pb-20 pt-6 sm:px-6 sm:pt-12">
        {open === null ? (
          <div className="grid place-items-center py-40">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : open === "error" ? (
          <Notice title="We couldn't open your application">
            Check your connection and refresh the page. If it keeps happening, call or text your
            rep.
          </Notice>
        ) : open.state !== "open" ? (
          <ClosedLink state={open.state} repName={rep?.name ?? null} />
        ) : done ? (
          <DoneScreen
            done={done}
            firstName={d.owners[0]?.first ?? ""}
            onDownload={() => {
              const s = lastSigned.current;
              if (s) void downloadApplicationPdf(s.src, s.values);
            }}
          />
        ) : (
          <>
            <Header
              repSlug={rep?.slug ?? repSlug}
              repName={repName}
              title={rep?.title ?? null}
              firstName={d.owners[0]?.first ?? ""}
              website={website}
            />

            {phoneMode && token && (
              <PhoneBanner
                synced={synced}
                business={d.business.legal_name}
                onSend={() => saveAndSend(token, d, step)}
              />
            )}

            {!contactDone && quickStep < QUESTIONS.length ? (
              <QuickQuestions
                step={quickStep}
                quick={quick}
                hrefFor={(key, id) =>
                  quickOptionHref(applicationPath(repSlug), carried, quick, key, id)
                }
                onChoose={(key, id) => {
                  const next = { ...quick, [key]: id };
                  setQuick(next);
                  saveQuick(store, next);
                  // brief pause so the selection registers before the next question
                  window.setTimeout(() => setQuickStep((n) => n + 1), 180);
                }}
                onBack={() => setQuickStep((n) => Math.max(0, n - 1))}
              />
            ) : !contactDone ? (
              <ContactGate
                repSlug={rep?.slug ?? repSlug}
                store={store}
                repFirst={repFirst}
                quick={quick}
                onBack={() => setQuickStep(QUESTIONS.length - 1)}
                onDone={(c) => {
                  markStarted(store);
                  update((x) => {
                    const y = withQuickAnswers(x, { ...quick, businessName: c.business });
                    return {
                      ...y,
                      business: {
                        ...y.business,
                        phone: y.business.phone || c.phone,
                        email: y.business.email || c.email,
                      },
                      owners: [
                        {
                          ...y.owners[0]!,
                          first: c.first,
                          last: c.last,
                          mobile: c.phone,
                          email: c.email,
                        },
                        ...y.owners.slice(1),
                      ],
                    };
                  });
                  setContactDone(true);
                  // a public link shows the rough range first, when the answers give one
                  if (!token && estimate(quick)) setShowRange(true);
                  window.scrollTo({ top: 0 });
                }}
              />
            ) : showRange ? (
              <RangeCard
                quick={quick}
                firstName={d.owners[0]?.first ?? ""}
                onContinue={() => {
                  setShowRange(false);
                  retryStart();
                  window.scrollTo({ top: 0 });
                }}
              />
            ) : (
              <>
                <Stepper
                  step={step}
                  visited={visited}
                  byStep={byStep}
                  onGo={(i) => i <= visited && go(i)}
                />

                <div
                  ref={cardRef}
                  className="ll-glass mt-6 scroll-mt-24 rounded-[1.75rem] p-5 ring-1 ring-line sm:p-9"
                >
                  <div key={current.id} className="rise">
                    <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-leaf">
                      Step {step + 1} of {STEPS.length}
                    </p>
                    <h2
                      ref={headingRef}
                      tabIndex={-1}
                      // focused by script when the step changes, for screen readers; no ring
                      style={{ outline: "none" }}
                      className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl"
                    >
                      {STEP_HEADLINE[current.id]}
                    </h2>
                    {showMissing && byStep[current.id].length > 0 && (
                      <p
                        className="mt-4 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line"
                        role="alert"
                      >
                        Still needed here: {byStep[current.id].join(", ")}.
                      </p>
                    )}
                    <div className="mt-8">
                      {current.id === "business" && <BusinessSection d={d} update={update} />}
                      {current.id === "owners" && (
                        <OwnersSection d={d} update={update} loginEmailNote />
                      )}
                      {current.id === "property" && <RealEstateSection d={d} update={update} />}
                      {current.id === "funding" && <FundingSection d={d} update={update} />}
                      {current.id === "statements" &&
                        (phoneMode ? (
                          <p className="rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
                            Bank statements go up from the merchant&apos;s side: they add them when
                            they open the link to sign, or send them to you later. Skip this step.
                          </p>
                        ) : (
                          <Statements files={files} setFiles={setFiles} />
                        ))}
                      {current.id === "sign" && (
                        <>
                          <Review d={d} onEdit={(i) => go(i)} files={files.length} />
                          <div className="mt-10 border-t border-line pt-8">
                            {phoneMode && token ? (
                              <HandOff
                                d={d}
                                token={token}
                                gaps={allMissing.filter((m) => !PRIVATE_GAP.test(m))}
                                repName={repName}
                              />
                            ) : (
                              <SignBlock
                                d={d}
                                s={sig}
                                set={(patch) => setSig((x) => ({ ...x, ...patch }))}
                                todo={allMissing}
                                error={error}
                                busy={busy}
                                onSign={() => void submit()}
                                cta={`Sign and send to ${repFirst}`}
                              />
                            )}
                            {uploading && (
                              <p className="mt-4 flex items-center justify-center gap-2 text-sm text-smoke">
                                <Loader2 className="size-4 animate-spin" /> Adding {uploading}…
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {current.id !== "sign" && (
                    <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-6">
                      <button
                        type="button"
                        onClick={() => go(step - 1)}
                        className={cn(btnOutline, "px-5 py-3", step === 0 && "invisible")}
                      >
                        <ArrowLeft className="size-4" /> Back
                      </button>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {visited === lastStep && step < lastStep - 1 && (
                          <button
                            type="button"
                            onClick={() => next(lastStep)}
                            className={cn(btnOutline, "px-5 py-3")}
                          >
                            Back to signing
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => next()}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-leaf px-6 py-3.5 font-semibold text-ink transition hover:-translate-y-0.5 hover:brightness-105"
                        >
                          {current.id === "statements" && files.length === 0
                            ? "Skip for now"
                            : "Continue"}
                          <ArrowRight className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* people never see this field; form-filling bots do */}

                <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-smoke">
                  <Lock className="size-3.5" />{" "}
                  {phoneMode
                    ? "Saved to Lamp for the merchant as you go, except the SSN and date of birth: they add those when they sign."
                    : "Encrypted and private. Saved on this device as you go, except your SSN and date of birth."}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

const startedKey = (rep: string) => `lamp.application.started.rep.${rep}`;

function hasStarted(rep: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(startedKey(rep)) === "1";
  } catch {
    return false;
  }
}

function markStarted(rep: string) {
  try {
    window.localStorage.setItem(startedKey(rep), "1");
  } catch {
    /* the page still works without it */
  }
}

const quickKey = (rep: string) => `lamp.application.quick.rep.${rep}`;

function loadQuick(rep: string): Partial<Record<ChoiceKey, string>> {
  try {
    if (typeof window === "undefined") return {};
    return cleanChoices(JSON.parse(window.localStorage.getItem(quickKey(rep)) ?? "{}"));
  } catch {
    return {};
  }
}

function saveQuick(rep: string, quick: Partial<Record<ChoiceKey, string>>) {
  try {
    window.localStorage.setItem(quickKey(rep), JSON.stringify(quick));
  } catch {
    /* the page still works without it */
  }
}

/**
 * A public link opens like the front page: the quick questions, one tap each, then name and
 * number. The answers go on the lead with the rep and fill what they can of the long form.
 */
function QuickQuestions({
  step,
  quick,
  hrefFor,
  onChoose,
  onBack,
}: {
  step: number;
  quick: Partial<Record<ChoiceKey, string>>;
  /** Each answer as a link, so a tap works before the page's script has loaded. */
  hrefFor: (key: ChoiceKey, id: string) => string;
  onChoose: (key: ChoiceKey, id: string) => void;
  onBack: () => void;
}) {
  const q = QUESTIONS[step]!;
  // the questions, then the contact screen
  const total = QUESTIONS.length + 1;
  const progress = Math.round(((step + 1) / total) * 100);
  return (
    <div className="ll-glass mt-6 rounded-[1.75rem] p-5 ring-1 ring-line sm:p-9" data-quick={q.key}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full bg-white ring-1 ring-line transition hover:ring-ink/30",
            step === 0 && "invisible",
          )}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-full bg-leaf transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-10 text-right text-sm font-semibold tabular-nums text-smoke">
          {step + 1}/{total}
        </span>
      </div>
      <div key={q.key} className="rise mt-8">
        <QuickQuestion
          q={q}
          value={quick[q.key]}
          hrefFor={(id) => hrefFor(q.key, id)}
          onChoose={(id) => onChoose(q.key, id)}
        />
      </div>
      <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-smoke">
        <Lock className="size-3.5" /> Checking your options never affects your credit.
      </p>
    </div>
  );
}

/**
 * A public link's first screen: who this is, before the long form. Saved at once (as a lead with
 * this rep, who is emailed) so a person who stops halfway can still be called. No account here;
 * that comes after signing.
 */
function ContactGate({
  repSlug,
  store,
  repFirst,
  quick,
  onBack,
  onDone,
}: {
  /** The rep the lead goes to; "" for the website (no rep). */
  repSlug: string;
  /** This browser's key for the progress token. */
  store: string;
  repFirst: string;
  quick: Partial<Record<ChoiceKey, string>>;
  onBack: () => void;
  onDone: (c: {
    first: string;
    last: string;
    business: string;
    phone: string;
    email: string;
  }) => void;
}) {
  const [first, setFirst] = useState("");
  const [business, setBusiness] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The server's HTML can reach this screen (option links work before the script loads), but the
  // form only works once the script runs: before that a native submit would drop the answers in
  // the URL, and typing would be lost on hydration. So it stays disabled until then.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) return setError("Add your first and last name.");
    if (!business.trim()) return setError("Add your business name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a 10-digit phone number.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email.");
    setBusy(true);
    setError("");
    const params = new URL(window.location.href).searchParams;
    const utm = Object.fromEntries([...params].filter(([k]) => k.startsWith("utm_")));
    const body = {
      rep: repSlug,
      first_name: first,
      last_name: last,
      business_name: business,
      phone,
      email,
      phone_consent: consent ? PHONE_CONSENT_TEXT : null,
      answers: quick,
      utm,
      form: "online",
    };
    // A request that never got the server's answer (no connection, a timeout, the edge's 5xx) is
    // kept in this tab and tried again, once now and once at the next step. The server's own 500
    // (it has emailed the team already), a 429 (this network's hourly cap) and a 404 (an inactive
    // rep) are not.
    const out = await sendStart(body, { send: fetchStart, storage: tabStorage(), store });
    if (out.outcome === "fix") {
      setBusy(false);
      return setError(out.error ?? "Check your details and try again.");
    }
    // how far they get from here is reported against this lead (see application-progress)
    if (out.progress) saveProgressToken(store, out.progress);
    // saved, kept for a retry, or the limit got in the way: either way they carry on with the form
    setBusy(false);
    onDone({
      first: first.trim(),
      last: last.trim(),
      business: business.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
    });
  }

  return (
    <form
      onSubmit={submit}
      className="ll-glass mt-6 rounded-[1.75rem] p-5 ring-1 ring-line sm:p-9"
      noValidate
    >
      <fieldset disabled={!ready} className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-smoke hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-leaf">
          Before you start
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Let's start with you
        </h2>
        <p className="mt-2 leading-relaxed text-smoke">
          Your name, business and number, so {repFirst} can help if you get stuck. The rest takes
          about 10 minutes, and it saves as you go.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <F label="First name">
            <Text value={first} onChange={setFirst} autoComplete="given-name" />
          </F>
          <F label="Last name">
            <Text value={last} onChange={setLast} autoComplete="family-name" />
          </F>
          <div className="sm:col-span-2">
            <F label="Business name">
              <Text value={business} onChange={setBusiness} autoComplete="organization" />
            </F>
          </div>
          <F label="Mobile phone">
            <Text value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel" />
          </F>
          <F label="Email">
            <Text value={email} onChange={setEmail} type="email" autoComplete="email" />
          </F>
        </div>
        <label htmlFor="start-consent" className="mt-5 flex items-start gap-3">
          <input
            id="start-consent"
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span className="text-sm leading-relaxed text-smoke">{PHONE_CONSENT_TEXT}</span>
        </label>
        {error && (
          <p className="mt-4 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className={cn(btnPrimary, "mt-6 w-full py-4 text-base")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Start my application
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </fieldset>
    </form>
  );
}

/**
 * After the contact screen on a public link: the rough range from their quick answers (the same
 * estimate the old website flow showed), then straight on into the full application. Never an
 * approval or an offer: real offers come from funders after they see the statements.
 */
function RangeCard({
  quick,
  firstName,
  onContinue,
}: {
  quick: Partial<Record<ChoiceKey, string>>;
  firstName: string;
  onContinue: () => void;
}) {
  const est = estimate(quick);
  if (!est) return null;
  const name = firstName || "there";
  return (
    <div className="rise ll-glass mt-6 rounded-[1.75rem] p-5 ring-1 ring-line sm:p-9" data-range>
      <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {est.fit === "limited"
          ? `Thanks, ${name}. Let's see what's realistic.`
          : `You have options, ${name}.`}
      </h2>
      <div className="mt-6 rounded-2xl bg-ink p-6 text-paper">
        <p className="text-mist">Businesses like yours often see</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-leaf">
          {money(est.low)} – {money(est.high)}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3">
          {(
            [
              ["Looking for", labelFor("amount", quick.amount)],
              ["Monthly deposits", labelFor("revenue", quick.revenue)],
              ["In business", labelFor("tib", quick.tib)],
              ["Needed", labelFor("timeline", quick.timeline)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
              <dt className="text-sm text-mist">{k}</dt>
              <dd className="font-semibold">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-mist">
          {est.fit === "limited"
            ? "Newer or smaller businesses have fewer options, but some funders still work with them. We'll be honest about what's out there."
            : "This is a rough estimate from your answers, not an offer. Real offers come from funders after they review your statements."}
        </p>
      </div>
      <p className="mt-6 leading-relaxed text-smoke">
        To get real offers, finish the application and add your last few bank statements. It saves
        as you go.
      </p>
      <button
        type="button"
        onClick={onContinue}
        className={cn(btnPrimary, "mt-5 w-full py-4 text-base")}
      >
        Finish my application · about 10 minutes
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const STEP_HEADLINE: Record<StepId, string> = {
  business: "Tell us about your business",
  owners: "Who owns it",
  property: "Do you own any real estate?",
  funding: "What you need",
  statements: "Add your bank statements",
  sign: "Check it over and sign",
};

function Header({
  repSlug,
  repName,
  title,
  firstName,
  website = false,
}: {
  repSlug: string;
  repName: string;
  title: string | null;
  firstName: string;
  /** The website's own application: no rep yet, so the card shows the Lamp team. */
  website?: boolean;
}) {
  const photo = website ? undefined : findRep(repSlug)?.photo;
  const initials = repName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header>
      <Eyebrow dark>Lamp working capital application</Eyebrow>
      <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
        {firstName ? `${firstName}, here's your application.` : "Your funding application."}
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-smoke">
        About ten minutes. Sign right on the page when you're done and it goes straight to{" "}
        {website ? "the Lamp team" : repName.split(" ")[0]}.
      </p>
      <div className="ll-glass mt-7 flex items-center gap-4 rounded-2xl px-4 py-3.5 ring-1 ring-line">
        {photo ? (
          <img src={photo} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-forest font-display font-bold text-leaf ring-1 ring-leaf/40"
          >
            {website ? "L" : initials || "L"}
          </span>
        )}
        <p className="text-[0.95rem] leading-snug">
          <span className="text-smoke">{website ? "Reviewed by" : "Your Lamp rep"}</span>
          <span className="block font-semibold">
            {website ? "The Lamp team" : repName}
            {title ? <span className="font-normal text-smoke"> · {title}</span> : null}
          </span>
        </p>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-leaf/15 px-3 py-1.5 text-xs font-semibold text-forest ring-1 ring-leaf/30 sm:inline-flex">
          <ShieldCheck className="size-3.5" /> No cost, no obligation
        </span>
      </div>
    </header>
  );
}

function Stepper({
  step,
  visited,
  byStep,
  onGo,
}: {
  step: number;
  visited: number;
  byStep: Record<StepId, string[]>;
  onGo: (i: number) => void;
}) {
  const pctDone = Math.round((step / (STEPS.length - 1)) * 100);
  return (
    <nav aria-label="Application steps" className="mt-10">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line sm:hidden"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]?.title ?? ""}`}
      >
        <div
          className="h-full rounded-full bg-leaf transition-all duration-500"
          style={{ width: `${Math.max(6, pctDone)}%` }}
        />
      </div>
      <ol className="hidden gap-1.5 sm:grid sm:grid-cols-6">
        {STEPS.map((s, i) => {
          // a check only for a step that was reached and has nothing missing
          const isDone = i <= visited && i !== step && byStep[s.id].length === 0;
          const here = i === step;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onGo(i)}
                disabled={i > visited}
                aria-current={here ? "step" : undefined}
                className={cn(
                  "flex w-full flex-col gap-2 rounded-xl px-2 py-2 text-left transition disabled:cursor-default",
                  i <= visited && !here && "hover:bg-sand",
                )}
              >
                <span
                  className={cn(
                    "h-1 rounded-full transition-colors",
                    here ? "bg-leaf" : isDone ? "bg-leaf/60" : "bg-line",
                  )}
                />
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold",
                    here ? "text-ink" : "text-smoke",
                  )}
                >
                  {isDone && !here && <Check className="size-3.5 text-forest" />}
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Statements({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const [note, setNote] = useState("");
  const add = (list: FileList | null) => {
    if (!list) return;
    setNote("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        setNote(`Up to ${MAX_FILES} files here; add the rest after you sign in.`);
        break;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        setNote(`${f.name} is over 20 MB. Download a smaller copy from your bank's website.`);
        continue;
      }
      // the same rule the upload route applies, so nothing is refused after signing
      if (!UPLOAD_TYPES.includes(uploadType(f))) {
        setNote(`${f.name} isn't a PDF, JPG, PNG or HEIC photo.`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };
  return (
    <div>
      <p className="max-w-xl text-smoke">
        Your last {countWord(STATEMENT_MONTHS)} months of business bank statements. Funding partners
        decide from these, so adding them now gets you offers faster. PDFs downloaded from your
        bank's website work best. No statements handy? Skip this and add them after you sign in.
      </p>
      <label
        className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-line bg-white px-6 py-10 text-center transition hover:border-leaf/60"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-leaf/15 text-forest ring-1 ring-leaf/30">
          <Upload className="size-5" />
        </span>
        <span className="font-semibold">Choose statements or drop them here</span>
        <span className="text-sm text-smoke">PDF, JPG, PNG or HEIC, up to 20 MB each</span>
        <input
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/heic,.pdf,.heic"
          className="sr-only"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p className="mt-3 text-sm text-smoke empty:hidden" role="status" aria-live="polite">
        {note}
      </p>
      {files.length > 0 && (
        <ul className="mt-5 space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-3 rounded-2xl bg-sand px-4 py-3 ring-1 ring-line"
            >
              <FileText className="size-4 shrink-0 text-forest" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.name}</span>
              <span className="text-xs tabular-nums text-smoke">
                {(f.size / 1048576).toFixed(1)} MB
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="grid size-7 place-items-center rounded-full text-smoke hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-smoke">
        They upload when you sign, along with your application.
      </p>
    </div>
  );
}

/** Everything they entered, short, with a way back to each step. */
function Review({
  d,
  onEdit,
  files,
}: {
  d: Details;
  onEdit: (step: number) => void;
  files: number;
}) {
  const b = d.business;
  const o = d.owners[0]!;
  const re = d.real_estate;
  const rows: { step: number; title: string; lines: string[] }[] = [
    {
      step: 0,
      title: "Business",
      lines: [
        [b.legal_name, b.dba && `DBA ${b.dba}`].filter(Boolean).join(" · "),
        [b.address, b.city, b.state, b.zip].filter(Boolean).join(", "),
        [b.entity_type, b.industry, b.start_date && `since ${b.start_date}`]
          .filter(Boolean)
          .join(" · "),
        b.monthly_revenue ? `${usd0(amount(b.monthly_revenue))} a month in revenue` : "",
      ],
    },
    {
      step: 1,
      title: "Owners",
      lines: d.owners.map((x) =>
        [`${x.first} ${x.last}`.trim(), x.ownership && `${x.ownership}%`, x.email]
          .filter(Boolean)
          .join(" · "),
      ),
    },
    {
      step: 2,
      title: "Real estate",
      lines:
        re.owns === "yes"
          ? re.properties.map((p) =>
              [p.address, p.city, p.value && `worth ${usd0(amount(p.value))}`]
                .filter(Boolean)
                .join(" · "),
            )
          : re.owns === "no"
            ? ["Doesn't own real estate"]
            : [],
    },
    {
      step: 3,
      title: "Funding",
      lines: [
        d.request.amount ? `Asking for ${usd0(amount(d.request.amount))}` : "",
        d.balances.length
          ? `${d.balances.length} current balance${d.balances.length > 1 ? "s" : ""}`
          : "No current balances",
      ],
    },
    {
      step: 4,
      title: "Statements",
      lines: [
        files
          ? `${files} file${files > 1 ? "s" : ""} to upload`
          : "None yet: add them after you sign in",
      ],
    },
  ];
  return (
    <div>
      <p className="text-smoke">
        Here's what goes to {o.first ? "your rep" : "Lamp"}. Tap Edit to change anything.
      </p>
      <dl className="mt-5 divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line">
        {rows.map((r) => (
          <div
            key={r.title}
            className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-5 py-4 sm:flex sm:gap-4"
          >
            <dt className="text-sm font-semibold sm:w-28 sm:shrink-0">{r.title}</dt>
            <dd className="col-span-2 min-w-0 flex-1 space-y-0.5 text-sm text-smoke">
              {r.lines.filter(Boolean).map((l) => (
                <p key={l} className="break-words">
                  {l}
                </p>
              ))}
            </dd>
            <button
              type="button"
              onClick={() => onEdit(r.step)}
              aria-label={`Edit ${r.title.toLowerCase()}`}
              className="col-start-2 row-start-1 self-start text-sm font-semibold text-forest underline-offset-4 hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DoneScreen({
  done,
  firstName,
  onDownload,
}: {
  done: Done;
  firstName: string;
  onDownload: () => void;
}) {
  const [email, setEmail] = useState(done.email);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  // the website's own application has no rep yet: the Lamp team has it
  const rep = done.rep_name || "the Lamp team";
  const repFirst = done.rep_name ? (done.rep_name.split(" ")[0] ?? done.rep_name) : "Lamp";
  const failed = done.uploads.filter((u) => !u.ok);

  return (
    <div className="rise">
      <div className="ll-glass rounded-[1.75rem] p-6 text-center ring-1 ring-line sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-leaf text-ink shadow-[0_0_40px_6px_oklch(0.615_0.117_150/0.45)]">
          <Check className="size-8" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Signed{firstName ? `, ${firstName}` : ""}. {repFirst} has it.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-smoke">
          Your application is with {rep} now. They'll review it and start shopping it to Lamp's
          funding partners.
        </p>
        {done.uploads.length > 0 && (
          <p className="mt-4 text-sm text-smoke">
            {done.uploads.length - failed.length} of {done.uploads.length} statements added.
            {failed.length > 0 &&
              ` ${failed.map((f) => f.name).join(", ")} didn't upload; add it after you sign in.`}
          </p>
        )}
        <button type="button" onClick={onDownload} className={cn(btnOutline, "mt-6 px-5 py-3")}>
          <Download className="size-4" /> Download my signed copy
        </button>
      </div>

      <div className="ll-glass mt-6 rounded-[1.75rem] p-6 ring-1 ring-line sm:p-9">
        <h2 className="font-display text-2xl font-bold tracking-tight">Follow your application</h2>
        <p className="mt-2 text-smoke">
          Create your free Lamp login to see where it stands, add statements, and compare offers
          when they come in. No password: we email you a sign-in link.
        </p>
        {state === "sent" ? (
          <div className="mt-6 rounded-2xl bg-sand p-5 ring-1 ring-line" role="status">
            <Mail className="size-6 text-forest" />
            <p className="mt-3 font-semibold">Check your inbox</p>
            <p className="mt-1 text-smoke">
              We sent a sign-in link to <strong className="text-ink">{email}</strong>. Open it and
              your application will be waiting in your account.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                setState("sending");
                setErr("");
                try {
                  await sendMagicLink(
                    email.trim().toLowerCase(),
                    firstName || undefined,
                    "/account",
                  );
                  setState("sent");
                } catch (x) {
                  setState("error");
                  setErr(x instanceof Error ? x.message : "Couldn't send the link. Try again.");
                }
              }}
            >
              <label htmlFor="login-email" className="sr-only">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={cn(inputCls, "flex-1 py-3.5")}
              />
              <button
                type="submit"
                disabled={state === "sending"}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-leaf px-6 py-3.5 font-semibold text-ink transition hover:brightness-105 disabled:opacity-50"
              >
                {state === "sending" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Email me a sign-in link
              </button>
            </form>
            {GOOGLE_SIGN_IN && (
              <>
                <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-smoke">
                  <span className="h-px flex-1 bg-line" /> or{" "}
                  <span className="h-px flex-1 bg-line" />
                </div>
                <GoogleButton onClick={() => void signInWithGoogle("/account")} />
              </>
            )}
            {state === "error" && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Today", `${repFirst} reviews your application and statements.`],
          ["Next", "Funding partners review it and send offers back to Lamp."],
          ["Then", "You compare offers side by side and choose. Say no to any of them."],
        ].map(([k, v]) => (
          <li key={k} className="rounded-2xl bg-white p-5 ring-1 ring-line">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-leaf">{k}</p>
            <p className="mt-2 text-sm text-smoke">{v}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ClosedLink({
  state,
  repName,
}: {
  state: OpenResponse["state"];
  repName: string | null;
}) {
  const who = repName ?? "your Lamp rep";
  if (state === "signed") {
    return (
      <Notice title="This application is already signed">
        {who} has it. Sign in to follow it and add documents.
        <Link
          to="/login"
          className="mt-6 inline-flex font-semibold text-forest underline underline-offset-4"
        >
          Sign in
        </Link>
      </Notice>
    );
  }
  if (state === "expired" || state === "cancelled") {
    return (
      <Notice title={state === "expired" ? "This link has expired" : "This link was replaced"}>
        Ask {who} for a new one{state === "cancelled" ? ", or use the newest link they sent" : ""}.
      </Notice>
    );
  }
  return (
    <Notice
      title={state === "unknown_rep" ? "We couldn't find that page" : "This link doesn't work"}
    >
      Check the link, or start a new application.
      <Link
        to="/application"
        className="mt-6 inline-flex font-semibold text-forest underline underline-offset-4"
      >
        Start an application
      </Link>
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ll-glass mx-auto mt-16 max-w-lg rounded-[1.75rem] p-8 text-center ring-1 ring-line">
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-3 flex flex-col items-center text-smoke">{children}</div>
    </div>
  );
}

/** On the phone: who this is for, that the rep doesn't sign, and whether it saved. */
export function PhoneBanner({
  synced,
  business,
  onSend,
}: {
  synced: { at: string } | { error: string } | null;
  business: string;
  /** Saves what's typed and emails them this link to finish on their own; says what happened. */
  onSend?: () => Promise<string>;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    if (!onSend) return;
    setSending(true);
    setSent(null);
    try {
      setSent({ ok: true, text: await onSend() });
    } catch (e) {
      setSent({ ok: false, text: e instanceof Error ? e.message : "Couldn't send. Try again." });
    } finally {
      setSending(false);
    }
  }
  return (
    <div
      className="mt-6 flex flex-wrap items-start gap-3 rounded-2xl bg-leaf/15 p-4 text-sm ring-1 ring-leaf/40"
      data-phone-mode
    >
      <Phone className="mt-0.5 size-4 shrink-0 text-forest" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          You&apos;re filling this in{business ? ` for ${business}` : ""} on the phone.
        </p>
        <p className="mt-0.5 text-smoke">
          Skip the SSN and date of birth. At the end, or the moment they have to go, email them this
          link, and they check it, add those and sign. Never sign for them.
        </p>
        {synced && (
          <p
            className={cn("mt-1 text-xs", "error" in synced ? "text-destructive" : "text-smoke")}
            data-phone-sync
          >
            {"error" in synced
              ? synced.error
              : `Saved to Lamp ${new Date(synced.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}
          </p>
        )}
        {sent && (
          <p
            className={cn("mt-1 text-xs", sent.ok ? "text-forest" : "text-destructive")}
            role="status"
            data-phone-sent
          >
            {sent.text}
          </p>
        )}
      </div>
      {onSend && (
        <button
          type="button"
          className={cn(btnOutline, "shrink-0 px-4 py-2 text-sm")}
          disabled={sending}
          onClick={() => void send()}
          title="They have to go? Lamp saves what you've filled in and emails them this link to finish."
          data-phone-send-now
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Email it to them to finish
        </button>
      )}
    </div>
  );
}

/**
 * They have to go mid-call: save what's typed to the link right now (not after the usual pause),
 * then email them the same link to finish, to the owner's email on the form or, failing that, the
 * one the link was made with. Returns the line to show the rep.
 */
export async function saveAndSend(
  token: string,
  d: Details,
  step: number,
  form?: "pdf",
): Promise<string> {
  const safe = { ...d, owners: d.owners.map((o) => ({ ...o, ssn: "", dob: "" })) };
  await postDraft({ action: "save", token, draft: safe, step });
  const typed = (d.owners[0]?.email || d.business.email || "").trim().toLowerCase();
  const r = await postDraft({
    action: "email",
    token,
    ...(EMAIL_RE.test(typed) ? { to: typed } : {}),
    ...(form ? { form } : {}),
  });
  return `Emailed to ${String(r["sent_to"] ?? typed)} with everything you've filled in. They finish it and sign.`;
}

/** The last step on the phone: send the same link for the merchant to check and sign. */
export function HandOff({
  d,
  token,
  gaps,
  repName,
  form,
}: {
  d: Details;
  token: string;
  gaps: string[];
  repName: string;
  /** "pdf": the link they get opens the paper application */
  form?: "pdf";
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const owner = d.owners[0];
  const first = owner?.first.trim() || "them";
  const to = (owner?.email || d.business.email || "").trim().toLowerCase();
  // the merchant's link is this page without the rep's ?fill=rep
  const url = (() => {
    if (typeof window === "undefined") return "";
    const u = new URL(window.location.href);
    u.searchParams.delete("fill");
    return u.toString();
  })();

  async function email() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postDraft({ action: "email", token, to, ...(form ? { form } : {}) });
      setMsg({
        ok: true,
        text: `Sent to ${String(r["sent_to"] ?? to)}. Stay on the line while they open it.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteSms(owner?.first ?? "", repName, url));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setMsg({ ok: false, text: url });
    }
  }

  return (
    <div data-hand-off>
      <h3 className="font-display text-xl font-bold">Send it to {first} to sign</h3>
      <p className="mt-2 text-sm text-smoke">
        They open the same application with everything you filled in, add their SSN and date of
        birth, check it over and sign. It lands on your board like any signed application.
      </p>
      {gaps.length > 0 && (
        <p className="mt-4 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
          Still blank, so they&apos;ll fill these in: {gaps.join(", ")}.
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn(btnPrimary, "px-6 py-3")}
          disabled={busy || !EMAIL_RE.test(to)}
          title={EMAIL_RE.test(to) ? undefined : "Add the owner's email on the Owners step first"}
          onClick={() => void email()}
          data-hand-off-email
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          {EMAIL_RE.test(to) ? `Email it to ${to}` : "Email it to them"}
        </button>
        <button
          type="button"
          className={cn(btnOutline, "px-6 py-3")}
          onClick={() => void copy()}
          data-hand-off-copy
        >
          <Copy className="size-4" />{" "}
          {copied ? "Copied: paste it in a text" : "Copy a text with the link"}
        </button>
      </div>
      {msg && (
        <p
          className={cn("mt-4 text-sm", msg.ok ? "text-forest" : "text-destructive")}
          role="status"
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
