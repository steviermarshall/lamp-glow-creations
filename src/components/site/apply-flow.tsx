import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import {
  answersFromParams,
  estimate,
  labelFor,
  loadDraft,
  money,
  PHONE_CONSENT_TEXT,
  QUESTIONS,
  saveDraft,
  utmFromParams,
  type Answers,
} from "@/lib/apply";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SITE, type Rep } from "@/lib/site";
import { useAuth, recordLead, saveDraftToAccount } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { btnOutline, btnPrimary, card, PageShell } from "@/components/site/layout";
import { GoogleButton, sendMagicLink, signInWithGoogle } from "@/components/site/auth";

const CONTACT_STEP = QUESTIONS.length;
const RESULT_STEP = QUESTIONS.length + 1;
const TOTAL = QUESTIONS.length + 2;

function firstOpenStep(a: Answers) {
  const i = QUESTIONS.findIndex((q) => !a[q.key]);
  if (i !== -1) return i;
  return a.firstName && a.businessName ? RESULT_STEP : CONTACT_STEP;
}

/** The question-first apply flow. A rep link passes `rep`, which tags the application ref=<slug>. */
export function ApplyFlow({ search, rep }: { search: Record<string, unknown>; rep?: Rep }) {
  const fromUrl = useMemo(() => answersFromParams(search), [search]);
  const utmFromUrl = useMemo(
    () => ({ ...utmFromParams(search), ...(rep ? { ref: rep.slug } : {}) }),
    [search, rep],
  );

  const [answers, setAnswers] = useState<Answers>(fromUrl);
  const [utm, setUtm] = useState<Record<string, string>>(utmFromUrl);
  const [step, setStep] = useState(() => firstOpenStep(fromUrl));
  const [startStep, setStartStep] = useState(step);

  // Merge any saved draft (URL params win), so returning visitors pick up where they left off.
  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    const merged = { ...draft.answers, ...fromUrl };
    setAnswers(merged);
    setUtm({ ...draft.utm, ...utmFromUrl });
    setStep(firstOpenStep(merged));
    setStartStep(firstOpenStep(merged));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveDraft({ answers, utm });
  }, [answers, utm]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const choose = (key: keyof Answers, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    // brief pause so the selection registers visually before advancing
    window.setTimeout(() => setStep((s) => s + 1), 180);
  };

  const progress = Math.round(((step + 1) / TOTAL) * 100);
  const q = QUESTIONS[step];

  return (
    <PageShell minimalHeader footer={false}>
      <div className="mx-auto flex max-w-xl flex-col px-5 pb-16 pt-6 sm:px-6 sm:pt-10">
        {rep && <RepBadge rep={rep} />}

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
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
              className="h-full rounded-full bg-amber transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="w-10 text-right text-sm font-semibold tabular-nums text-smoke">
            {Math.min(step + 1, TOTAL)}/{TOTAL}
          </span>
        </div>

        <div key={step} className="rise mt-10">
          {q && (
            <>
              {step === startStep && answers.firstName && (
                <p className="mb-2 font-semibold text-amber-deep">Hi {answers.firstName}.</p>
              )}
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {q.title}
              </h1>
              {q.subtitle && <p className="mt-3 text-lg text-smoke">{q.subtitle}</p>}
              <div className="mt-8 grid gap-3" role="radiogroup" aria-label={q.title}>
                {q.options.map((o) => {
                  const selected = answers[q.key] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => choose(q.key, o.id)}
                      className={cn(
                        "flex items-center justify-between rounded-2xl px-5 py-4 text-left text-[1.05rem] font-semibold transition",
                        selected
                          ? "bg-amber/15 ring-2 ring-amber"
                          : "bg-white ring-1 ring-line hover:ring-ink/30",
                      )}
                    >
                      {o.label}
                      <span
                        className={cn(
                          "grid size-6 place-items-center rounded-full ring-1",
                          selected ? "bg-amber text-ink ring-amber" : "ring-line",
                        )}
                      >
                        {selected && <Check className="size-4" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === CONTACT_STEP && (
            <ContactStep
              answers={answers}
              onSubmit={(patch) => {
                setAnswers((a) => ({ ...a, ...patch }));
                setStep(RESULT_STEP);
              }}
            />
          )}

          {step === RESULT_STEP && (
            <ResultStep answers={answers} utm={utm} setAnswers={setAnswers} />
          )}
        </div>

        <p className="mt-10 flex items-center justify-center gap-2 text-center text-sm text-smoke">
          <Lock className="size-3.5" /> Your answers are private and never affect your credit.
        </p>
      </div>
    </PageShell>
  );
}

function RepBadge({ rep }: { rep: Rep }) {
  const initials = rep.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-line">
      {rep.photo ? (
        <img src={rep.photo} alt="" className="size-10 rounded-full object-cover" />
      ) : (
        <span
          className="grid size-10 place-items-center rounded-full bg-ink font-display text-sm font-bold text-amber"
          aria-hidden="true"
        >
          {initials}
        </span>
      )}
      <p className="text-[0.95rem] leading-snug">
        You're working with <strong>{rep.name}</strong>
        {rep.title ? `, ${rep.title}` : ""} at Lamp.
        <span className="block text-sm text-smoke">They'll see your file as soon as it's in.</span>
      </p>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl bg-white px-4 py-3.5 text-base text-ink ring-1 ring-line placeholder:text-smoke/60 focus:outline-none focus:ring-2 focus:ring-sky";

function ContactStep({
  answers,
  onSubmit,
}: {
  answers: Answers;
  onSubmit: (patch: Answers) => void;
}) {
  const [firstName, setFirstName] = useState(answers.firstName ?? "");
  const [businessName, setBusinessName] = useState(answers.businessName ?? "");
  const [phone, setPhone] = useState(answers.phone ?? "");
  const [consent, setConsent] = useState(Boolean(answers.phoneConsent));
  const hasPhone = phone.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName: firstName.trim(),
      businessName: businessName.trim(),
      ...(hasPhone ? { phone: phone.trim() } : {}),
      // Keep a record of exactly what they agreed to and when.
      ...(hasPhone && consent
        ? { phoneConsent: `${new Date().toISOString()} | ${PHONE_CONSENT_TEXT}` }
        : {}),
    });
  };

  return (
    <form onSubmit={submit}>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Last thing: who are we helping?
      </h1>
      <p className="mt-3 text-lg text-smoke">
        So your offers come back with the right name on them.
      </p>
      <div className="mt-8 space-y-5">
        <Field id="first-name" label="Your first name">
          <input
            id="first-name"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputCls}
            placeholder="Maria"
          />
        </Field>
        <Field id="business-name" label="Business name">
          <input
            id="business-name"
            required
            autoComplete="organization"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={inputCls}
            placeholder="Maria's Kitchen LLC"
          />
        </Field>
        <Field
          id="phone"
          label="Mobile number"
          hint="Optional. For a quick text when offers are ready."
        >
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
            placeholder="(201) 555-0123"
          />
        </Field>
        {hasPhone && (
          <label
            htmlFor="phone-consent"
            className="flex cursor-pointer items-start gap-3 rounded-xl bg-sand px-4 py-3.5 ring-1 ring-line"
          >
            <input
              id="phone-consent"
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-[oklch(0.52_0.12_58)]"
            />
            <span className="text-sm leading-relaxed text-smoke">{PHONE_CONSENT_TEXT}</span>
          </label>
        )}
      </div>
      <button type="submit" className={cn(btnPrimary, "mt-8 w-full py-4 text-base")}>
        See my results <ArrowRight className="size-4" />
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-sm text-smoke">{hint}</p>}
    </div>
  );
}

function ResultStep({
  answers,
  utm,
  setAnswers,
}: {
  answers: Answers;
  utm: Record<string, string>;
  setAnswers: (fn: (a: Answers) => Answers) => void;
}) {
  const est = estimate(answers);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(answers.email ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const name = answers.firstName || "there";

  // No approval-odds language here: a range from self-reported answers is not a verdict.
  const headline =
    est?.fit === "limited"
      ? `Thanks, ${name}. Let's see what's realistic.`
      : `You have options, ${name}.`;

  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const clean = email.trim().toLowerCase();
    setAnswers((a) => ({ ...a, email: clean }));
    saveDraft({ answers: { ...answers, email: clean }, utm });
    try {
      await recordLead({ answers: { ...answers, email: clean }, utm }).catch(() => undefined);
      await sendMagicLink(clean, answers.firstName);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  const saveForSignedIn = async () => {
    if (!user) return;
    setStatus("saving");
    try {
      await saveDraftToAccount(user.id, user.email);
      navigate({ to: "/account" });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{headline}</h1>

      {est && (
        <div className="mt-6 rounded-2xl bg-ink p-6 text-paper">
          <p className="text-mist">Businesses like yours often see</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-amber">
            {money(est.low)} – {money(est.high)}
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {(
              [
                ["Looking for", labelFor("amount", answers.amount)],
                ["Monthly deposits", labelFor("revenue", answers.revenue)],
                ["In business", labelFor("tib", answers.tib)],
                ["Needed", labelFor("timeline", answers.timeline)],
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
      )}

      <div className="mt-8">
        <h2 className="font-display text-xl font-bold">
          {user ? "Save this to your account" : "Create your free account to get real offers"}
        </h2>
        <p className="mt-2 text-smoke">
          {user
            ? "Then upload your statements and we'll start shopping your file."
            : "Save your answers, upload statements securely, and see your offers side by side when they come in."}
        </p>

        {!isSupabaseConfigured ? (
          <div className="mt-6 rounded-xl bg-sand p-4 text-smoke ring-1 ring-line">
            Online accounts are being set up. In the meantime,{" "}
            <a
              className="font-semibold text-ink underline"
              href={`mailto:${SITE.email}?subject=${encodeURIComponent(
                `Application — ${answers.businessName ?? ""}`,
              )}&body=${encodeURIComponent(summaryText(answers))}`}
            >
              email us your answers
            </a>{" "}
            and we'll get started.
          </div>
        ) : loading ? (
          <Loader2 className="mt-6 size-5 animate-spin text-smoke" />
        ) : user ? (
          <button
            type="button"
            onClick={saveForSignedIn}
            disabled={status === "saving"}
            className={cn(btnPrimary, "mt-6 w-full py-4 text-base")}
          >
            {status === "saving" ? <Loader2 className="size-4 animate-spin" /> : null}
            Save and continue
          </button>
        ) : status === "sent" ? (
          <div className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-line" role="status">
            <Mail className="size-6 text-amber-deep" />
            <p className="mt-3 font-semibold">Check your inbox</p>
            <p className="mt-1 text-smoke">
              We sent a sign-in link to <strong className="text-ink">{email}</strong>. Tap it on
              this device and your answers will be waiting.
            </p>
            <button
              type="button"
              className="mt-4 font-semibold text-amber-deep underline underline-offset-4"
              onClick={() => setStatus("idle")}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <GoogleButton onClick={() => signInWithGoogle()} />
            <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-smoke">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <form onSubmit={onEmail} className="space-y-3">
              <label htmlFor="apply-email" className="sr-only">
                Email address
              </label>
              <input
                id="apply-email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@business.com"
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className={cn(btnOutline, "w-full py-4 text-base")}
              >
                {status === "sending" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Continue with email
              </button>
            </form>
            <p className="text-sm leading-relaxed text-smoke">
              No password needed. We'll email you a secure sign-in link. By continuing you agree to
              our{" "}
              <a className="underline" href="/terms">
                Terms
              </a>{" "}
              and{" "}
              <a className="underline" href="/privacy">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        )}

        {status === "error" && (
          <p className="mt-4 text-destructive" role="alert">
            {error}
          </p>
        )}

        <p className="mt-6 flex items-center gap-2 text-sm text-smoke">
          <ShieldCheck className="size-4 text-amber-deep" /> No cost, no obligation. Say no to any
          offer.
        </p>
      </div>
    </div>
  );
}

function summaryText(a: Answers) {
  return QUESTIONS.map((q) => `${q.title} ${labelFor(q.key, a[q.key]) ?? "—"}`)
    .concat([
      `Name: ${a.firstName ?? ""}`,
      `Business: ${a.businessName ?? ""}`,
      `Phone: ${a.phone ?? ""}`,
    ])
    .join("\n");
}
