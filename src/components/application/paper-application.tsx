import { useEffect, useMemo, useRef, useState } from "react";
import { visitHeaders } from "@/lib/visit-headers";
import { ChevronLeft, ChevronRight, Loader2, PenLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveSignedCopy } from "@/lib/signed-copy";
import {
  BANKRUPTCY,
  cleanDetails,
  CONSENT_VERSION,
  detailsToPdf,
  emptyDetails,
  fromRow,
  fundedAnswer,
  missing,
  US_STATES,
  type Details,
} from "@/lib/application-details";
import { amount } from "@/lib/real-estate";
import { CHECKBOXES } from "@/lib/application-boxes";
import {
  applicationPdfBytes,
  downloadApplicationPdf,
  warmApplicationPdf,
} from "@/lib/application-pdf-lazy";
import {
  BLANK_APPLICATION_PDF,
  EMAIL_RE,
  saveClaim,
  type OpenResponse,
  type SubmitResponse,
} from "@/lib/application-links";
import {
  boxOf,
  gapIndexes,
  place,
  PAPER_ITEMS,
  shown,
  SIGN_BOXES,
  tidyPaper,
  wrongBoxes,
  type Box,
  type PaperField,
  type PaperGroup,
  type PaperItem,
} from "@/lib/paper-form";
import {
  paperStage,
  progressToken,
  rank,
  reportStage,
  saveProgressToken,
  type Stage,
} from "@/lib/application-progress";
import { fixTarget, gapHeadline, gapList, isQuestionGap, nextGap } from "@/lib/paper-gaps";
import { postStart, startOutcome } from "@/lib/application-start";
import { PageShell } from "@/components/site/layout";
import { SignBlock } from "@/components/application/sign-block";
import { emptySigning, YES_NO, type Signing } from "@/components/application/form-kit";
import { Choice, F, inputCls, Select } from "@/components/application/fields";
import {
  ClosedLink,
  DoneScreen,
  HandOff,
  PhoneBanner,
  saveAndSend,
  postDraft,
  PRIVATE_GAP,
  Statements,
  type Done,
} from "@/components/application/link-application";

/**
 * The paper application on the page (getlamp.app/application/<rep>/pdf): the printed form with a
 * box to type in over every box on it, the two answers the form has no room for, statements, and
 * the same signing step as the online application. On a wide screen the boxes are typed into in
 * place; on a phone a tap opens the box in a large editor at the top, with Next through the form.
 * Signing sends it the way the online link does (form "pdf"), so it lands in the rep's files.
 *
 * With a token it's a merchant's personal link (getlamp.app/application/<rep>/pdf?i=<token>): it
 * opens with what the rep already knows, or what the rep filled in on the call. With fill=rep as
 * well, it's Start application: the rep fills it in with the merchant on the phone, every change
 * saves to the link on Lamp's server, and the end sends the link to the merchant to sign instead
 * of signing.
 */

/** Below this width (CSS px) the page's boxes are too small to type into: tap to edit. */
const TAP_MODE_WIDTH = 640;
/** Typing pauses this long before the contact boxes are sent or a section counts as done. */
const SETTLE_MS = 2500;
/**
 * Saved in this browser while they fill it in; never the SSN or date of birth. A personal link
 * keys it by the invite (the same across a resent link), the rep's public link by the rep.
 */
const draftKey = (rep: string, invite?: string | null) =>
  invite ? `lamp.paper.v1.invite.${invite}` : `lamp.paper.v1.${rep}`;

const withoutPrivate = (d: Details): Details => ({
  ...d,
  owners: d.owners.map((o) => ({ ...o, ssn: "", dob: "" })),
});

function loadDraft(key: string): { d: Details; savedAt: number } | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    // { d, savedAt } since personal links; plain answers before that
    if (v["d"] && typeof v["d"] === "object")
      return {
        d: fromRow(v["d"] as Record<string, unknown>),
        savedAt: typeof v["savedAt"] === "number" ? v["savedAt"] : 0,
      };
    return { d: fromRow(v), savedAt: 0 };
  } catch {
    return null;
  }
}

function saveDraft(key: string, d: Details) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ d: withoutPrivate(d), savedAt: Date.now() }));
  } catch {
    /* private mode or full storage: they just won't get it back after a reload */
  }
}

function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing saved */
  }
}

export function PaperApplication({
  repSlug,
  token = null,
  filling = false,
}: {
  repSlug: string;
  /** a merchant's personal link */
  token?: string | null;
  /** a rep filling it in with the merchant on the phone (Start application) */
  filling?: boolean;
}) {
  // only a personal link can be filled in for someone
  const phoneMode = filling && Boolean(token);
  const [synced, setSynced] = useState<{ at: string } | { error: string } | null>(null);
  const [open, setOpen] = useState<OpenResponse | "error" | null>(null);
  const [d, setD] = useState<Details>(emptyDetails);
  const [sig, setSig] = useState<Signing>(emptySigning);
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const lastSigned = useRef<{
    src: Parameters<typeof downloadApplicationPdf>[0];
    values: Parameters<typeof downloadApplicationPdf>[1];
  } | null>(null);
  const signRef = useRef<HTMLDivElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  // "Fill in what's missing": which box to open, and a count so the same box can be opened twice
  const [jump, setJump] = useState<{ index: number; n: number } | null>(null);
  const started = useRef(false);
  const key = draftKey(repSlug, open && open !== "error" ? open.draft : null);

  // the application is always the light look, like the online one
  useEffect(() => {
    document.documentElement.dataset["theme"] = "light";
  }, []);

  // the PDF builder arrives in the background, so it is there by the time they sign
  useEffect(() => warmApplicationPdf(), []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/application/open", {
          method: "POST",
          headers: await visitHeaders(),
          body: JSON.stringify(token ? { token } : { rep: repSlug }),
        });
        const o = (await res.json().catch(() => null)) as OpenResponse | null;
        if (!live) return;
        if (!res.ok || !o || typeof o.state !== "string") return setOpen("error");
        setOpen(o);
        if (o.state !== "open") return;
        const local = loadDraft(draftKey(repSlug, o.draft));
        // answers a rep filled in on the phone, when they're newer than this browser's own
        const serverAt = o.answers_saved_at ? Date.parse(o.answers_saved_at) : 0;
        if (o.answers && serverAt > (local?.savedAt ?? 0)) return setD(fromRow(o.answers));
        if (local) return setD(local.d);
        const p = o.prefill;
        if (p)
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
      } catch {
        if (live) setOpen("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [repSlug, token]);

  const update = (next: Details) => {
    setD(next);
    saveDraft(key, next);
    // a personal link counts as started at the first answer, like the online one
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

  // on the phone, every change saves to the link on Lamp's server, a moment after typing stops
  useEffect(() => {
    if (!phoneMode || !token || !open || open === "error" || open.state !== "open") return;
    const t = window.setTimeout(() => {
      postDraft({ action: "save", token, draft: withoutPrivate(d), step: 0 })
        .then((r) => setSynced({ at: String(r["saved_at"] ?? new Date().toISOString()) }))
        .catch((e: unknown) =>
          setSynced({ error: e instanceof Error ? e.message : "Couldn't save to Lamp." }),
        );
    }, 1200);
    return () => window.clearTimeout(t);
  }, [d, phoneMode, token, open]);

  const tidy = useMemo(() => tidyPaper(d), [d]);

  // Once the owner's name, mobile and email are in, they're a lead with this rep (who is emailed
  // to help), the way the online link's first screen works; then the furthest section done is
  // reported, so the rep knows where they stopped. Both wait for typing to settle.
  const o1 = tidy.owners[0]!;
  const contact =
    o1.first.trim() &&
    o1.last.trim() &&
    o1.mobile.replace(/\D/g, "").length >= 10 &&
    EMAIL_RE.test(o1.email.trim())
      ? {
          first: o1.first.trim(),
          last: o1.last.trim(),
          phone: o1.mobile.trim(),
          email: o1.email.trim(),
        }
      : null;
  const contactKey = contact ? JSON.stringify(contact) : "";
  const captured = useRef(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [startProblem, setStartProblem] = useState("");
  useEffect(() => {
    // a personal link already knows who it's for, and its opens and starts are counted on it
    if (token || !contactKey || captured.current || open === null || open === "error") return;
    if (progressToken(repSlug)) {
      captured.current = true;
      setTokenReady(true);
      return;
    }
    const t = window.setTimeout(() => {
      captured.current = true;
      const c = JSON.parse(contactKey) as {
        first: string;
        last: string;
        phone: string;
        email: string;
      };
      const params = new URL(window.location.href).searchParams;
      const utm = Object.fromEntries([...params].filter(([k]) => k.startsWith("utm_")));
      // tried again once on a 5xx or no answer (postStart); a 400 is shown to the person; a change
      // to the contact boxes tries again after anything that didn't save
      void postStart(() =>
        fetch("/api/application/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rep: repSlug,
            first_name: c.first,
            last_name: c.last,
            phone: c.phone,
            email: c.email,
            phone_consent: null,
            utm,
            form: "pdf",
          }),
        }),
      ).then((a) => {
        const o = startOutcome(a);
        setStartProblem(o.problem);
        if (o.token) {
          saveProgressToken(repSlug, o.token);
          setTokenReady(true);
        }
        if (o.retryOnChange) captured.current = false;
      });
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [contactKey, open, repSlug, token]);

  const stage = useMemo(() => paperStage(tidy), [tidy]);
  const reported = useRef<Stage | null>(null);
  useEffect(() => {
    if (!tokenReady || stage === "contact") return;
    if (reported.current && rank(stage) <= rank(reported.current)) return;
    const t = window.setTimeout(() => {
      reported.current = stage;
      reportStage(repSlug, stage, "pdf");
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [stage, repSlug, tokenReady]);
  const todo = useMemo(() => missing(tidy, { propertyDetails: false }), [tidy]);
  const wrong = useMemo(() => (tried ? wrongBoxes(d) : new Set<string>()), [tried, d]);
  const rep = open && open !== "error" ? open.rep : null;
  const repName = rep?.name ?? "your Lamp rep";
  const repFirst = repName.split(" ")[0] ?? repName;

  // On a phone the form is a picture about 350 px wide and its boxes are about 6 px tall, so a
  // merchant told only to "fill in the boxes marked in red" had nothing they could press (found
  // 2026-11-23 with a form a rep had filled in: the SSN and date of birth were all that was left).
  // These take them straight to what is missing. Live, not waiting for a first try at signing.
  const gaps = useMemo(() => gapIndexes(d), [d]);
  const toQuestions = () =>
    questionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const toSign = () => signRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const fix = () => {
    setTried(true);
    setError("");
    const t = fixTarget(gaps, todo);
    if (t?.kind === "box") setJump((j) => ({ index: t.index, n: (j?.n ?? 0) + 1 }));
    else if (t?.kind === "questions") toQuestions();
  };
  // the form arrived with a rep's answers on it, so the merchant is here to finish, not start
  const repFilled = !phoneMode && !!open && open !== "error" && !!open.answers;

  async function submit() {
    setError("");
    setTried(true);
    const clean = cleanDetails(tidy);
    const owner = clean.owners[0]!;
    if (todo.length)
      return setError("Some answers are still missing. Press Fill in what's missing, then sign.");
    if (!sig.agree) return setError("Tick the box to agree to the authorization.");
    if (sig.typed.trim().length < 3) return setError("Type your full name to sign.");
    if (!sig.image) return setError("Draw your signature in the box.");
    const co = clean.owners[1];
    const second = sig.second && !!co;
    if (second && !sig.image2) return setError(`${co.first} draws their signature in the box.`);
    setBusy(true);
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
          token: token ?? null,
          rep: token ? undefined : repSlug,
          form: "pdf",
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

    // the signed PDF, with what the database stamped, goes with the file for funders; if this
    // fails staff build the same PDF from the saved answers
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
      try {
        const err = await upload(f, f.name, "bank_statement");
        uploads.push(err ? { name: f.name, ok: false, error: err } : { name: f.name, ok: true });
      } catch {
        uploads.push({ name: f.name, ok: false, error: "Didn't upload" });
      }
    }
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

  return (
    <PageShell member themeToggle={false} minimalHeader footer={false} tone="night">
      <div className="mx-auto max-w-4xl px-3 pb-20 pt-6 sm:px-6 sm:pt-10">
        {open === null ? (
          <div className="grid place-items-center py-40">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : token && open !== "error" && open.state !== "open" ? (
          <div className="mx-auto max-w-xl py-16">
            <ClosedLink state={open.state} repName={open.rep?.name ?? null} />
          </div>
        ) : open === "error" || open.state !== "open" ? (
          <div className="mx-auto max-w-xl py-24 text-center">
            <h1 className="font-display text-2xl font-bold">
              {open !== "error" && open.state === "unknown_rep"
                ? "We couldn't find that rep's page."
                : "This page didn't load."}
            </h1>
            <p className="mt-2 text-smoke">Check the link, or call the person who sent it.</p>
          </div>
        ) : done ? (
          <div className="mx-auto max-w-3xl">
            <DoneScreen
              done={done}
              firstName={tidy.owners[0]?.first ?? ""}
              onDownload={() => {
                const s = lastSigned.current;
                if (s) void downloadApplicationPdf(s.src, s.values, "all");
              }}
            />
          </div>
        ) : (
          <>
            <div className="px-1">
              <p className="text-sm text-smoke">Working capital application with {repName}</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                Fill it in, then sign at the bottom.
              </h1>
              <p className="mt-2 text-sm text-smoke">
                Tap any box on the form to fill it in.
                {!token &&
                  ` Your name and number go to ${repFirst} once you enter them, so they can help if you get stuck.`}{" "}
                Prefer paper?{" "}
                <a
                  className="font-semibold text-forest underline underline-offset-2"
                  href={BLANK_APPLICATION_PDF}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download the PDF
                </a>
                .
              </p>
              {startProblem && (
                <p className="mt-2 text-sm font-semibold text-destructive" role="alert">
                  Your details didn&apos;t reach {repFirst}: {startProblem} Fix it in the
                  owner&apos;s boxes on the form.
                </p>
              )}
            </div>

            {phoneMode && token && (
              <PhoneBanner
                synced={synced}
                business={d.business.legal_name.trim()}
                onSend={() => saveAndSend(token, d, 0, "pdf")}
              />
            )}

            {!phoneMode && todo.length > 0 && (repFilled || tried) && (
              <div
                className="mt-5 rounded-2xl bg-white p-4 ring-2 ring-amber-500/60 sm:p-5"
                data-paper-gaps
              >
                <p className="font-semibold">
                  {gapHeadline(todo, repFilled ? (rep ? repFirst : "Your rep") : null)}
                </p>
                <p className="mt-1 text-sm text-smoke">{gapList(todo)}.</p>
                <button
                  type="button"
                  onClick={fix}
                  className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
                  data-fix-gaps
                >
                  <PenLine className="size-4" /> {todo.length === 1 ? "Add it now" : "Add them now"}
                </button>
              </div>
            )}

            <PaperPage
              d={d}
              update={update}
              wrong={wrong}
              sig={sig}
              repName={rep?.name ?? ""}
              onSignBox={toSign}
              jump={jump}
              gaps={gaps}
              onGapsDone={() => (todo.some(isQuestionGap) ? toQuestions() : toSign())}
            />

            <section
              ref={questionsRef}
              className="mt-6 scroll-mt-24 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7"
            >
              <h2 className="font-display text-lg font-semibold">Three more questions</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <F label="Has the business or an owner ever filed for bankruptcy?">
                  <Select
                    value={d.business.bankruptcy}
                    onChange={(v) =>
                      update({
                        ...d,
                        business: {
                          ...d.business,
                          bankruptcy: v as Details["business"]["bankruptcy"],
                        },
                      })
                    }
                    options={BANKRUPTCY.map((b) => ({ id: b.id, label: b.label }))}
                  />
                  {tried && !d.business.bankruptcy && (
                    <p className="mt-1.5 text-sm font-semibold text-destructive">
                      Choose an answer.
                    </p>
                  )}
                </F>
                {d.business.bankruptcy && d.business.bankruptcy !== "none" && (
                  <F label="Year it was filed">
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      maxLength={4}
                      value={d.business.bankruptcy_year}
                      onChange={(e) =>
                        update({
                          ...d,
                          business: { ...d.business, bankruptcy_year: e.target.value },
                        })
                      }
                    />
                  </F>
                )}
                <div className="sm:col-span-2">
                  <span className="mb-1.5 block text-[0.8rem] font-semibold text-smoke">
                    Do you own any real estate, business or personal?
                  </span>
                  <Choice
                    label="Own real estate"
                    value={d.real_estate.owns}
                    options={YES_NO}
                    onChange={(v) => update({ ...d, real_estate: { ...d.real_estate, owns: v } })}
                  />
                  {d.real_estate.owns === "yes" && (
                    <p className="mt-2 text-sm text-smoke">
                      {repFirst} will ask you about it after you sign.
                    </p>
                  )}
                  {tried && !d.real_estate.owns && (
                    <p className="mt-1.5 text-sm font-semibold text-destructive">
                      Choose Yes or No.
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="mb-1.5 block text-[0.8rem] font-semibold text-smoke">
                    Do you have any business funding with a balance today?
                  </span>
                  <Choice
                    label="Business funding with a balance today"
                    value={fundedAnswer(d)}
                    options={YES_NO}
                    onChange={(v) =>
                      update({
                        ...d,
                        request: { ...d.request, funded: v as Details["request"]["funded"] },
                      })
                    }
                  />
                  {fundedAnswer(d) === "yes" && (
                    <p className="mt-2 text-sm text-smoke">
                      Put the company and the balance in the Current funding row on the form.
                    </p>
                  )}
                  {tried && !fundedAnswer(d) && (
                    <p className="mt-1.5 text-sm font-semibold text-destructive">
                      Choose Yes or No.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7">
              <h2 className="font-display text-lg font-semibold">
                Bank statements <span className="text-sm font-normal text-smoke">optional</span>
              </h2>
              <div className="mt-3">
                {phoneMode ? (
                  <p className="rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
                    Bank statements go up from the merchant&apos;s side: they add them when they
                    open the link to sign, or send them to you later.
                  </p>
                ) : (
                  <Statements files={files} setFiles={setFiles} />
                )}
              </div>
            </section>

            <div
              ref={signRef}
              className="mt-6 scroll-mt-24 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7"
            >
              {phoneMode && token ? (
                <HandOff
                  d={tidy}
                  token={token}
                  gaps={todo.filter((m) => !PRIVATE_GAP.test(m))}
                  repName={repName}
                  form="pdf"
                />
              ) : (
                <SignBlock
                  d={tidy}
                  s={sig}
                  set={(patch) => setSig((x) => ({ ...x, ...patch }))}
                  todo={todo}
                  error={error}
                  busy={busy}
                  onSign={() => void submit()}
                  cta={`Sign and send to ${repFirst}`}
                  onFix={fix}
                />
              )}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

/** The printed form with the answers on it: typed into in place, or tapped open on a phone. */
function PaperPage({
  d,
  update,
  wrong,
  sig,
  repName,
  onSignBox,
  jump,
  gaps,
  onGapsDone,
}: {
  d: Details;
  update: (d: Details) => void;
  wrong: Set<string>;
  sig: Signing;
  repName: string;
  onSignBox: () => void;
  /** "Fill in what's missing" was pressed: open this box (n counts presses) */
  jump: { index: number; n: number } | null;
  /** the required boxes not yet right, as indexes into PAPER_ITEMS */
  gaps: number[];
  /** the last unfinished box was just filled in from "Fill in what's missing" */
  onGapsDone: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tap, setTap] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  // "gaps": Next walks only the boxes still to fill, not all of them
  const [walk, setWalk] = useState<"all" | "gaps">("all");
  const jumped = useRef(0);

  // On a phone, the editor opens on that box and Next goes to the next unfinished one. On a wide
  // screen the box itself is typed into, so it is brought into view and focused.
  useEffect(() => {
    if (!jump || jump.n === jumped.current) return;
    jumped.current = jump.n;
    const item = PAPER_ITEMS[jump.index];
    if (!item) return;
    if (tap) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setWalk("gaps");
      setEditing(jump.index);
      return;
    }
    const el = ref.current?.querySelector<HTMLElement>(`[data-box="${item.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }, [jump, tap]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setTap(el.clientWidth < TAP_MODE_WIDTH);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const owner = (i: number) => d.owners[i];
  const fullName = (i: number) => `${owner(i)?.first ?? ""} ${owner(i)?.last ?? ""}`.trim();
  const today = new Date().toLocaleDateString("en-US");
  const signLine = (i: 0 | 1) => {
    const image = i === 0 ? sig.image : sig.second ? sig.image2 : null;
    const box = i === 0 ? SIGN_BOXES.owner1_signature : SIGN_BOXES.owner2_signature;
    return (
      <button
        type="button"
        onClick={onSignBox}
        aria-label={i === 0 ? "Sign below" : "Second owner signs below"}
        className={cn(
          "absolute flex items-center justify-center rounded-sm",
          !image && "bg-leaf/25 ring-1 ring-leaf hover:bg-leaf/40",
        )}
        style={{ ...place(pad(box, 0, 4)) }}
      >
        {image ? (
          <img src={image} alt="Signature" className="h-full w-full object-contain" />
        ) : (
          (i === 0 || owner(1)) && (
            <span className="flex items-center gap-1 font-semibold text-forest">
              <PenLine className="size-[1.4cqw]" /> Sign below
            </span>
          )
        )}
      </button>
    );
  };
  const printed = (box: Box, text: string) => (
    <span
      className="absolute flex items-center overflow-hidden whitespace-nowrap px-[0.3cqw] text-ink"
      style={place(box)}
    >
      {text}
    </span>
  );

  return (
    <>
      <div
        ref={ref}
        className="relative mt-5 w-full overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.5)] ring-1 ring-line [container-type:inline-size]"
        style={{ aspectRatio: "612 / 792" }}
        data-paper-page
      >
        <img
          src="/forms/lamp-application-page.png"
          alt="Lamp working capital application form"
          className="absolute inset-0 h-full w-full select-none"
          draggable={false}
        />
        {/* cqw is measured against the nearest container above the element that uses it, so the
            text size is set here, inside the page (a size on the page itself measured the window
            and came out ~70% too big on wide screens, overflowing the boxes) */}
        <div className="absolute inset-0 leading-none" style={{ fontSize: "1.3cqw" }}>
          {PAPER_ITEMS.map((item, i) =>
            tap ? (
              <TapBox
                key={item.id}
                item={item}
                d={d}
                wrong={wrong.has(item.id)}
                onOpen={() => {
                  setWalk("all");
                  setEditing(i);
                }}
              />
            ) : item.kind === "field" ? (
              <InPlaceField
                key={item.id}
                item={item}
                d={d}
                update={update}
                wrong={wrong.has(item.id)}
              />
            ) : (
              <InPlaceGroup
                key={item.id}
                item={item}
                d={d}
                update={update}
                wrong={wrong.has(item.id)}
              />
            ),
          )}
          {printed(SIGN_BOXES.lamp_rep, repName)}
          {printed(SIGN_BOXES.owner1_print_name, fullName(0))}
          {printed(SIGN_BOXES.owner1_sign_date, sig.image ? today : "")}
          {owner(1) && printed(SIGN_BOXES.owner2_print_name, fullName(1))}
          {printed(SIGN_BOXES.owner2_sign_date, sig.second && sig.image2 ? today : "")}
          {signLine(0)}
          {owner(1) && signLine(1)}
        </div>
      </div>
      {tap && editing !== null && (
        <Editor
          index={editing}
          d={d}
          update={update}
          walk={walk}
          gaps={gaps}
          onMove={setEditing}
          onClose={() => {
            const finished = walk === "gaps" && gaps.length === 0;
            setEditing(null);
            setWalk("all");
            if (finished) onGapsDone();
          }}
        />
      )}
    </>
  );
}

/** A box grown by dx, dy points each side: a bigger target than the printed square. */
const pad = ([x0, y0, x1, y1]: Box, dx: number, dy: number): Box => [
  x0 - dx,
  y0 - dy,
  x1 + dx,
  y1 + dy,
];

const boxCls =
  "absolute rounded-[0.2cqw] bg-leaf/10 px-[0.4cqw] leading-none text-ink outline-none transition focus:bg-white focus:ring-2 focus:ring-leaf [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:size-[1.1cqw]";

function InPlaceField({
  item,
  d,
  update,
  wrong,
}: {
  item: PaperField;
  d: Details;
  update: (d: Details) => void;
  wrong: boolean;
}) {
  const style = place(boxOf(item));
  const cls = cn(boxCls, wrong && "bg-destructive/10 ring-2 ring-destructive/70");
  const set = (v: string) => update(item.set(d, v));
  if (item.input === "select" || item.input === "state") {
    const options = item.input === "state" ? US_STATES : (item.options ?? []);
    return (
      <select
        aria-label={item.label}
        data-box={item.id}
        className={cn(cls, "appearance-none")}
        style={style}
        value={item.input === "state" ? item.get(d).toUpperCase() : item.get(d)}
        onChange={(e) => set(e.target.value)}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={item.label}
      data-box={item.id}
      className={cls}
      style={style}
      {...inputProps(item)}
      value={item.get(d)}
      onChange={(e) => set(e.target.value)}
    />
  );
}

function InPlaceGroup({
  item,
  d,
  update,
  wrong,
}: {
  item: PaperGroup;
  d: Details;
  update: (d: Details) => void;
  wrong: boolean;
}) {
  const on = item.get(d);
  return (
    <>
      {item.choices.map((c, n) => {
        const checked = on.includes(c.value);
        return (
          <button
            key={c.box}
            type="button"
            role={item.multi ? "checkbox" : "radio"}
            aria-checked={checked}
            aria-label={`${item.label}: ${c.label}`}
            {...(n === 0 ? { "data-box": item.id } : {})}
            className={cn(
              "absolute grid place-items-center rounded-[0.2cqw] hover:bg-leaf/20",
              wrong && "bg-destructive/10 ring-1 ring-destructive/70",
            )}
            style={place(pad(CHECKBOXES[c.box]!, 1.5, 1.5))}
            onClick={() => update(item.set(d, toggle(item, on, c.value)))}
          >
            {checked && <span className="font-bold leading-none text-ink">✓</span>}
          </button>
        );
      })}
    </>
  );
}

const toggle = (item: PaperGroup, on: string[], v: string) =>
  item.multi
    ? on.includes(v)
      ? on.filter((x) => x !== v)
      : [...on, v]
    : on.includes(v)
      ? []
      : [v];

function TapBox({
  item,
  d,
  wrong,
  onOpen,
}: {
  item: PaperItem;
  d: Details;
  wrong: boolean;
  onOpen: () => void;
}) {
  if (item.kind === "group") {
    const on = item.get(d);
    return (
      <>
        <button
          type="button"
          aria-label={`${item.label}: ${
            item.choices
              .filter((c) => on.includes(c.value))
              .map((c) => c.label)
              .join(", ") || "not answered"
          }`}
          data-box={item.id}
          className={cn(
            "absolute rounded-[0.3cqw] bg-leaf/10 ring-1 ring-leaf/40",
            wrong && "bg-destructive/10 ring-destructive/70",
          )}
          style={place(pad(boxOf(item), 1.5, 1.5))}
          onClick={onOpen}
        />
        {item.choices
          .filter((c) => on.includes(c.value))
          .map((c) => (
            <span
              key={c.box}
              aria-hidden
              className="pointer-events-none absolute grid place-items-center font-bold leading-none text-ink"
              style={place(CHECKBOXES[c.box]!)}
            >
              ✓
            </span>
          ))}
      </>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${item.label}: ${shown(item, d) || "empty"}`}
      data-box={item.id}
      className={cn(
        "absolute overflow-hidden whitespace-nowrap rounded-[0.3cqw] bg-leaf/10 px-[0.4cqw] text-left text-ink",
        wrong && "bg-destructive/10 ring-1 ring-destructive/70",
      )}
      style={place(boxOf(item))}
      onClick={onOpen}
    >
      {mask(item, shown(item, d))}
    </button>
  );
}

/** On the page an SSN shows only its last four. */
const mask = (item: PaperField, v: string) =>
  item.id.endsWith("_ssn") && v.replace(/\D/g, "").length >= 4
    ? `***-**-${v.replace(/\D/g, "").slice(-4)}`
    : v;

function inputProps(item: PaperField) {
  switch (item.input) {
    case "email":
      return { type: "email", inputMode: "email" as const, autoComplete: "off" };
    case "tel":
      return { type: "tel", inputMode: "tel" as const };
    case "numeric":
      return { type: "text", inputMode: "numeric" as const };
    case "money":
      return { type: "text", inputMode: "decimal" as const };
    case "date":
      return { type: "date" };
    default:
      return { type: "text" };
  }
}

/** The phone editor: one box at a time, big, at the top of the screen, with Back and Next. */
function Editor({
  index,
  d,
  update,
  walk,
  gaps,
  onMove,
  onClose,
}: {
  index: number;
  d: Details;
  update: (d: Details) => void;
  /** "gaps" (from "Fill in what's missing"): Next goes to the next box still to fill */
  walk: "all" | "gaps";
  gaps: number[];
  onMove: (i: number) => void;
  onClose: () => void;
}) {
  const item = PAPER_ITEMS[index]!;
  const last = PAPER_ITEMS.length - 1;
  const next = walk === "gaps" ? nextGap(gaps, index) : index < last ? index + 1 : null;
  const forward = () => (next === null ? onClose() : onMove(next));
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [index]);
  return (
    <div
      role="dialog"
      aria-label={item.label}
      className="fixed inset-x-0 top-0 z-50 border-b border-line bg-white p-4 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.4)]"
      data-paper-editor
    >
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-smoke">{item.label}</p>
          <button
            type="button"
            aria-label="Close"
            className="ml-auto rounded-full p-1.5 text-smoke ring-1 ring-line"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2">
          {item.kind === "group" ? (
            <div className="flex flex-wrap gap-2" role={item.multi ? "group" : "radiogroup"}>
              {item.choices.map((c) => {
                const on = item.get(d).includes(c.value);
                return (
                  <button
                    key={c.box}
                    type="button"
                    role={item.multi ? "checkbox" : "radio"}
                    aria-checked={on}
                    className={cn(
                      "rounded-full px-4 py-2.5 text-sm font-semibold",
                      on ? "bg-leaf text-ink ring-1 ring-leaf" : "bg-white ring-1 ring-line",
                    )}
                    onClick={() => update(item.set(d, toggle(item, item.get(d), c.value)))}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ) : item.input === "select" || item.input === "state" ? (
            <select
              ref={(el) => {
                inputRef.current = el;
              }}
              className={inputCls}
              value={item.input === "state" ? item.get(d).toUpperCase() : item.get(d)}
              onChange={(e) => update(item.set(d, e.target.value))}
            >
              <option value="">Choose</option>
              {(item.input === "state" ? US_STATES : (item.options ?? [])).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              // a new element for each box: one that turns from a text box into a date box while
              // it has the focus (Enter, or the phone keyboard's Next key) takes no typing
              key={item.id}
              ref={(el) => {
                inputRef.current = el;
              }}
              className={inputCls}
              {...inputProps(item)}
              value={item.get(d)}
              enterKeyHint={next !== null ? "next" : "done"}
              onChange={(e) => update(item.set(d, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  forward();
                }
              }}
            />
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-line disabled:opacity-40"
            onClick={() => onMove(index - 1)}
          >
            <ChevronLeft className="size-4" /> Back
          </button>
          <span className="text-xs text-smoke tabular-nums" data-editor-count>
            {walk === "gaps"
              ? gaps.length
                ? `${gaps.length} still needed`
                : "All filled in"
              : `${index + 1} of ${PAPER_ITEMS.length}`}
          </span>
          {next !== null ? (
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              onClick={() => onMove(next)}
            >
              Next <ChevronRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className="ml-auto rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
