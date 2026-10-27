import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Download, Loader2, Lock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { findRep } from "@/lib/site";
import { CONSENT_VERSION, detailsToPdf, fromRow, type Details } from "@/lib/application-details";
import { amount } from "@/lib/real-estate";
import { downloadApplicationPdf } from "@/lib/application-pdf";
import type { ChangesOpenResponse, ChangesSubmitResponse } from "@/lib/application-changes";
import { btnOutline, Eyebrow, PageShell } from "@/components/site/layout";
import { ChangeForm } from "@/components/application/change-form";
import { F, inputCls } from "@/components/application/fields";
import type { Signing } from "@/components/application/form-kit";

/**
 * The update link a rep's "Send back for changes" emails: getlamp.app/application/<rep>/changes
 * #c=<token>. The token rides in the fragment, which is never sent to a server or in a Referer.
 * The merchant confirms their date of birth, then updates their signed application (SSN and date
 * of birth stay on file) and signs again. Merchant copy: never the word "loan".
 */

type Opened = ChangesOpenResponse & {
  state: "open";
  request: NonNullable<ChangesOpenResponse["request"]>;
};

const tokenFromHash = () => {
  if (typeof window === "undefined") return null;
  const m = /(?:^#|&)c=([A-Za-z0-9_-]{40,64})(?:&|$)/.exec(window.location.hash);
  return m?.[1] ?? null;
};

async function post(
  body: object,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/application/changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export function ChangeApplication({ repSlug }: { repSlug: string }) {
  const [token] = useState(tokenFromHash);
  const [state, setState] = useState<ChangesOpenResponse | "error" | null>(null);
  const [opened, setOpened] = useState<{ o: Opened; base: Details; dob: string } | null>(null);
  const [dob, setDob] = useState("");
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<(ChangesSubmitResponse & { d: Details; s: Signing }) | null>(
    null,
  );
  const honeypot = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ state: "not_found" });
      return;
    }
    let live = true;
    post({ action: "open", token })
      .then((r) => {
        if (!live) return;
        setState(
          r.ok && typeof r.data["state"] === "string" ? (r.data as ChangesOpenResponse) : "error",
        );
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [token]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || checking) return;
    setChecking(true);
    try {
      const r = await post({ action: "open", token, dob, event: "start" });
      const o = r.data as ChangesOpenResponse;
      if (!r.ok || typeof o.state !== "string") setState("error");
      else if (o.state === "open" && o.request) {
        setOpened({
          o: o as Opened,
          base: fromRow((o.prefill ?? {}) as Record<string, unknown>),
          dob,
        });
        setState(o);
        window.scrollTo({ top: 0 });
      } else setState(o);
    } catch {
      setState("error");
    } finally {
      setChecking(false);
    }
  }

  async function sign(d: Details, s: Signing) {
    if (!token || !opened) return;
    setBusy(true);
    setError("");
    const second = s.second && !!d.owners[1];
    try {
      const r = await post({
        action: "submit",
        token,
        dob: opened.dob,
        base_version: opened.o.request.base_version,
        details: d,
        signature: {
          name: s.typed.trim(),
          image: s.image,
          name2: second ? s.typed2.trim() : null,
          image2: second ? s.image2 : null,
        },
        consent_version: CONSENT_VERSION,
        company_fax: honeypot.current?.value ?? "",
      });
      if (!r.ok) {
        const missingList = r.data["missing"];
        setError(
          Array.isArray(missingList) && missingList.length
            ? `Still needed: ${missingList.join(", ")}.`
            : String(r.data["error"] ?? "Couldn't sign the update. Try again, or call your rep."),
        );
        return;
      }
      setDone({ ...(r.data as unknown as ChangesSubmitResponse), d, s });
      window.scrollTo({ top: 0 });
    } catch {
      setError("Couldn't reach Lamp. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const info = state && state !== "error" ? state : null;
  // a file can lose its rep after the link went out: then the copy says "your rep"
  const repName = info?.rep?.name ?? null;
  const repFirst = repName?.split(" ")[0] || null;

  return (
    <PageShell minimalHeader footer={false} tone="night">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-12">
        {state === null ? (
          <div className="grid place-items-center py-40">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : state === "error" ? (
          <Notice title="We couldn't open your application">
            Check your connection and refresh the page. If it keeps happening, call or text your
            rep.
          </Notice>
        ) : done ? (
          <Done
            done={done}
            repFirst={repFirst}
            repName={repName}
            firstName={info?.first_name ?? ""}
            signedBefore={opened?.o.request.signed_before_at ?? null}
          />
        ) : state.state === "open" && opened ? (
          <>
            <Header
              repSlug={info?.rep?.slug ?? repSlug}
              repName={repName ?? "Your Lamp rep"}
              title={info?.rep?.title ?? null}
            />
            <h1 className="mt-8 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {info?.first_name ? `${info.first_name}, one more thing.` : "One more thing."}
            </h1>
            <p className="mt-3 max-w-xl text-lg leading-relaxed text-smoke">
              Add what {repFirst ?? "your rep"} asked for, check it over and sign again. It takes a
              couple of minutes.
            </p>
            <div className="mt-8">
              <ChangeForm
                base={opened.base}
                items={opened.o.request.items}
                message={opened.o.request.message}
                repName={repName}
                secondSignedBefore={opened.o.request.second_signed_before}
                busy={busy}
                error={error}
                onSign={(d, s) => void sign(d, s)}
                cta={repFirst ? `Sign and send to ${repFirst}` : "Sign and send"}
              />
            </div>
            <input
              ref={honeypot}
              name="company_fax"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
            />
            <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-smoke">
              <Lock className="size-3.5" /> Encrypted and private. Nothing is saved on this device.
            </p>
          </>
        ) : state.state === "verify" ? (
          <>
            <Header
              repSlug={info?.rep?.slug ?? repSlug}
              repName={repName ?? "Your Lamp rep"}
              title={info?.rep?.title ?? null}
            />
            <div className="ll-glass mx-auto mt-10 max-w-lg rounded-[1.75rem] p-6 ring-1 ring-line sm:p-9">
              <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {info?.first_name ? `Hi ${info.first_name}.` : "Hi."} First, confirm it's you.
              </h1>
              <p className="mt-3 text-smoke">
                {repFirst ?? "Your Lamp rep"} asked for an update to your application
                {info?.business_name ? ` for ${info.business_name}` : ""}. Enter the date of birth
                on your application to open it.
              </p>
              <form className="mt-6 space-y-4" onSubmit={(e) => void verify(e)}>
                <F label="Your date of birth">
                  <input
                    type="date"
                    required
                    autoComplete="bday"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className={cn(inputCls, "py-3.5")}
                  />
                </F>
                {state.wrong && (
                  <div className="space-y-2 text-sm" role="alert">
                    <p className="text-destructive">
                      That doesn't match your application.
                      {typeof state.tries_left === "number" &&
                        ` ${state.tries_left} ${state.tries_left === 1 ? "try" : "tries"} left.`}
                    </p>
                    <p className="text-smoke">
                      If the date on your application was wrong, sign in with the email this link
                      came to instead: your application opens in your account, ready to update.{" "}
                      <Link
                        to="/login"
                        className="font-semibold text-forest underline underline-offset-4"
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={checking || !dob}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-leaf px-6 py-3.5 font-semibold text-ink transition hover:brightness-105 disabled:opacity-50"
                >
                  {checking && <Loader2 className="size-4 animate-spin" />} Open my application
                </button>
              </form>
              <p className="mt-5 flex items-center gap-2 text-xs text-smoke">
                <ShieldCheck className="size-3.5 shrink-0" /> This keeps your application private if
                the email reaches someone else.
              </p>
            </div>
          </>
        ) : (
          <Closed state={state.state} repName={repName ?? "your Lamp rep"} />
        )}
      </div>
    </PageShell>
  );
}

function Header({
  repSlug,
  repName,
  title,
}: {
  repSlug: string;
  repName: string;
  title: string | null;
}) {
  const photo = findRep(repSlug)?.photo;
  const initials = repName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header>
      <Eyebrow dark>Lamp working capital application</Eyebrow>
      <div className="ll-glass mt-5 flex items-center gap-4 rounded-2xl px-4 py-3.5 ring-1 ring-line">
        {photo ? (
          <img src={photo} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-forest font-display font-bold text-leaf ring-1 ring-leaf/40"
          >
            {initials || "L"}
          </span>
        )}
        <p className="text-[0.95rem] leading-snug">
          <span className="text-smoke">Your Lamp rep</span>
          <span className="block font-semibold">
            {repName}
            {title ? <span className="font-normal text-smoke"> · {title}</span> : null}
          </span>
        </p>
      </div>
    </header>
  );
}

function Done({
  done,
  repFirst,
  repName,
  firstName,
  signedBefore,
}: {
  done: ChangesSubmitResponse & { d: Details; s: Signing };
  repFirst: string | null;
  repName: string | null;
  firstName: string;
  signedBefore: string | null;
}) {
  const download = () => {
    const d = done.d;
    const second = done.s.second && !!d.owners[1];
    void downloadApplicationPdf(
      {
        answers: null,
        first_name: d.owners[0]?.first ?? null,
        business_name: d.business.legal_name,
        phone: d.business.phone,
        email: d.owners[0]?.email ?? null,
        amount_requested: amount(d.request.amount),
        repName,
      },
      detailsToPdf(
        d,
        {
          name: done.s.typed.trim(),
          at: done.signed_at,
          image: done.s.image,
          name2: second ? done.s.typed2.trim() : null,
          image2: second ? done.s.image2 : null,
          via: "link",
          ip: done.signer_ip,
          agent: navigator.userAgent,
          consent: CONSENT_VERSION,
          version: done.version,
          replaces: signedBefore,
        },
        repName,
      ),
    );
  };
  return (
    <div className="rise">
      <div className="ll-glass rounded-[1.75rem] p-6 text-center ring-1 ring-line sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-leaf text-ink shadow-[0_0_40px_6px_oklch(0.615_0.117_150/0.45)]">
          <Check className="size-8" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Signed{firstName ? `, ${firstName}` : ""}. {repFirst ?? "Your rep"} has your update.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-smoke">
          Your updated application replaces the one you signed before. {repFirst ?? "Your rep"} will
          take it from here.
        </p>
        <button type="button" onClick={download} className={cn(btnOutline, "mt-6 px-5 py-3")}>
          <Download className="size-4" /> Download my signed copy
        </button>
        <p className="mt-2 text-xs text-smoke">Your SSN and date of birth show as on file.</p>
      </div>
      <div className="ll-glass mt-6 rounded-[1.75rem] p-6 ring-1 ring-line sm:p-9">
        <h2 className="font-display text-2xl font-bold tracking-tight">Follow your application</h2>
        <p className="mt-2 text-smoke">
          Sign in with{" "}
          {done.email ? (
            <strong className="text-ink">{done.email}</strong>
          ) : (
            "the email on your application"
          )}{" "}
          to see where it stands, add statements, and compare offers when they come in.
        </p>
        <Link
          to="/login"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-leaf px-6 py-3.5 font-semibold text-ink transition hover:brightness-105"
        >
          Sign in to Lamp
        </Link>
      </div>
    </div>
  );
}

function Closed({ state, repName }: { state: ChangesOpenResponse["state"]; repName: string }) {
  const who = repName;
  const notices: Partial<Record<ChangesOpenResponse["state"], [string, ReactNode]>> = {
    done: ["You already signed this update", `${who} has it. Sign in to follow your application.`],
    withdrawn: [
      "No update needed anymore",
      `${who} doesn't need this update now. Your application stands as you signed it.`,
    ],
    closed: ["This application is closed", `Call or text ${who} if something needs to change.`],
    stopped: ["This link was replaced", `Use the newest email ${who} sent, or ask for a new one.`],
    expired: ["This link has expired", `Ask ${who} for a new one.`],
    locked: [
      "This link is locked",
      `The date of birth didn't match too many times. Ask ${who} to send a new link, or sign in with the email this link came to and update it from your account.`,
    ],
    sign_in: [
      "Update it from your Lamp account",
      "Sign in with the email on your application: your application opens in your account, ready to update.",
    ],
  };
  const [title, text] = notices[state] ?? [
    "This link doesn't work",
    `Check the link in the email, or ask ${who} for a new one.`,
  ];
  return (
    <Notice title={title}>
      {text}
      {(state === "done" || state === "sign_in" || state === "locked") && (
        <Link
          to="/login"
          className="mt-6 inline-flex font-semibold text-forest underline underline-offset-4"
        >
          Sign in
        </Link>
      )}
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
