import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import {
  answersFromParams,
  estimate,
  labelFor,
  loadDraft,
  money,
  QUESTIONS,
  saveDraft,
  utmFromParams,
  type Answers,
} from "@/lib/apply";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuth, recordLead, saveDraftToAccount } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, card, PageShell } from "@/components/site/layout";
import { GoogleButton, sendMagicLink, signInWithGoogle } from "@/components/site/auth";

export const Route = createFileRoute("/apply")({
  validateSearch: (search: Record<string, unknown>) => search as Record<string, string | undefined>,
  head: () => ({
    meta: [
      { title: "Check your options — Lamp" },
      {
        name: "description",
        content:
          "Answer a few quick questions to see what your business could qualify for. About a minute, and no effect on your credit.",
      },
    ],
  }),
  component: Apply,
});

const CONTACT_STEP = QUESTIONS.length;
const RESULT_STEP = QUESTIONS.length + 1;
const TOTAL = QUESTIONS.length + 2;

function firstOpenStep(a: Answers) {
  const i = QUESTIONS.findIndex((q) => !a[q.key]);
  if (i !== -1) return i;
  return a.firstName && a.businessName ? RESULT_STEP : CONTACT_STEP;
}

function Apply() {
  const search = Route.useSearch();
  const fromUrl = useMemo(() => answersFromParams(search), [search]);
  const utmFromUrl = useMemo(() => utmFromParams(search), [search]);

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
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full ring-1 ring-white/15 transition hover:bg-white/5",
              step === 0 && "invisible",
            )}
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-aurora-a to-aurora-b transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="w-10 text-right text-xs font-semibold tabular-nums text-mist">
            {Math.min(step + 1, TOTAL)}/{TOTAL}
          </span>
        </div>

        <div key={step} className="rise mt-10">
          {q && (
            <>
              {step === startStep && answers.firstName && (
                <p className="mb-2 text-sm font-semibold text-aurora-a">
                  Hi {answers.firstName} 👋
                </p>
              )}
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {q.title}
              </h1>
              {q.subtitle && <p className="mt-3 text-mist">{q.subtitle}</p>}
              <div className="mt-8 grid gap-3">
                {q.options.map((o) => {
                  const selected = answers[q.key] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => choose(q.key, o.id)}
                      className={cn(
                        "flex items-center justify-between rounded-2xl px-5 py-4 text-left text-base font-semibold ring-1 transition",
                        selected
                          ? "bg-aurora-a/15 text-white ring-aurora-a"
                          : "bg-white/5 text-white ring-white/10 hover:bg-white/10 hover:ring-white/25",
                      )}
                    >
                      {o.label}
                      <span
                        className={cn(
                          "grid size-6 place-items-center rounded-full ring-1",
                          selected ? "bg-aurora-a text-ink ring-aurora-a" : "ring-white/20",
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

        <p className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-mist/70">
          <Lock className="size-3.5" /> Your answers are private and never affect your credit.
        </p>
      </div>
    </PageShell>
  );
}

const inputCls =
  "w-full rounded-xl bg-white/5 px-4 py-3.5 text-base text-white ring-1 ring-white/10 placeholder:text-mist/50 focus:outline-none focus:ring-2 focus:ring-aurora-a";

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName: firstName.trim(),
      businessName: businessName.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    });
  };

  return (
    <form onSubmit={submit}>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Last thing — who are we helping?
      </h1>
      <p className="mt-3 text-mist">So your offers come back with the right name on them.</p>
      <div className="mt-8 space-y-4">
        <Field label="Your first name">
          <input
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputCls}
            placeholder="Maria"
          />
        </Field>
        <Field label="Business name">
          <input
            required
            autoComplete="organization"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={inputCls}
            placeholder="Maria's Kitchen LLC"
          />
        </Field>
        <Field label="Mobile number" hint="Optional — for a quick text when offers are ready.">
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
            placeholder="(201) 555-0123"
          />
        </Field>
      </div>
      <button type="submit" className={cn(btnPrimary, "mt-8 w-full py-4 text-base")}>
        See my results <ArrowRight className="size-4" />
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-mist">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-mist/60">{hint}</span>}
    </label>
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

  const headline =
    est?.fit === "strong"
      ? `Good news, ${answers.firstName || "there"} — you look like a strong fit.`
      : est?.fit === "limited"
        ? `Thanks, ${answers.firstName || "there"}. Let's see what's realistic.`
        : `You've got options, ${answers.firstName || "there"}.`;

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
        <div className={cn(card, "mt-6 p-6")}>
          <p className="text-sm font-medium text-mist">Businesses like yours often see</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight">
            <span className="bg-gradient-to-r from-aurora-a to-aurora-b bg-clip-text text-transparent">
              {money(est.low)} – {money(est.high)}
            </span>
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {(
              [
                ["Looking for", labelFor("amount", answers.amount)],
                ["Monthly deposits", labelFor("revenue", answers.revenue)],
                ["In business", labelFor("tib", answers.tib)],
                ["Needed", labelFor("timeline", answers.timeline)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-3 py-2.5">
                <dt className="text-xs text-mist/70">{k}</dt>
                <dd className="font-semibold text-white">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-mist/70">
            {est.fit === "limited"
              ? "Newer or smaller businesses have fewer options, but some funders still work with them. We'll be honest about what's out there."
              : "This is a rough estimate from your answers, not an offer. Real offers come from funders after they review your statements."}
          </p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-display text-xl font-semibold">
          {user ? "Save this to your account" : "Create your free account to get real offers"}
        </h2>
        <p className="mt-2 text-sm text-mist">
          {user
            ? "Then upload your statements and we'll start shopping your file."
            : "Save your answers, upload statements securely, and see your offers side by side when they come in."}
        </p>

        {!isSupabaseConfigured ? (
          <div className="mt-6 rounded-xl bg-aurora-c/10 p-4 text-sm text-mist ring-1 ring-aurora-c/30">
            Online accounts are being set up. In the meantime,{" "}
            <a
              className="font-semibold text-white underline"
              href={`mailto:hello@getlamp.app?subject=${encodeURIComponent(
                `Application — ${answers.businessName ?? ""}`,
              )}&body=${encodeURIComponent(summaryText(answers))}`}
            >
              email us your answers
            </a>{" "}
            and we'll get started.
          </div>
        ) : loading ? (
          <Loader2 className="mt-6 size-5 animate-spin text-mist" />
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
          <div className="mt-6 rounded-2xl bg-aurora-a/10 p-5 ring-1 ring-aurora-a/30">
            <Mail className="size-6 text-aurora-a" />
            <p className="mt-3 font-semibold text-white">Check your inbox</p>
            <p className="mt-1 text-sm text-mist">
              We sent a sign-in link to <strong className="text-white">{email}</strong>. Tap it on
              this device and your answers will be waiting.
            </p>
            <button
              type="button"
              className="mt-4 text-sm font-semibold text-aurora-a underline underline-offset-4"
              onClick={() => setStatus("idle")}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <GoogleButton onClick={() => signInWithGoogle()} />
            <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-mist/50">
              <span className="h-px flex-1 bg-white/10" /> or{" "}
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <form onSubmit={onEmail} className="space-y-3">
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@business.com"
                aria-label="Email address"
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className={cn(btnGhost, "w-full py-4 text-base")}
              >
                {status === "sending" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Continue with email
              </button>
            </form>
            <p className="text-xs leading-relaxed text-mist/60">
              No password needed — we'll email you a secure sign-in link. By continuing you agree to
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

        {status === "error" && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <p className="mt-6 flex items-center gap-2 text-xs text-mist/70">
          <ShieldCheck className="size-4 text-aurora-a" /> No cost, no obligation. Say no to any
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
