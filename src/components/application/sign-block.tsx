import { Lock, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONSENT_TEXT, type Details } from "@/lib/application-details";
import { F, inputCls } from "@/components/application/fields";
import { SignaturePad } from "@/components/application/signature-pad";
import type { Signing } from "@/components/application/form-kit";

/**
 * The signing step: the authorization to read, the box to tick, the typed name and the drawn
 * signature, for the owner and (optionally) the second owner. The page that uses it does the
 * saving; this only collects. Shared by the application link page and the account page.
 */

export function SignBlock({
  d,
  s,
  set,
  todo,
  error,
  busy,
  onSign,
  cta,
}: {
  d: Details;
  s: Signing;
  set: (patch: Partial<Signing>) => void;
  /** What's still missing in the application itself. */
  todo: string[];
  error: string;
  busy: boolean;
  onSign: () => void;
  cta: string;
}) {
  const owner = d.owners[0]!;
  const co = d.owners[1];
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  // a second signer only counts while there is a second owner to sign for
  const second = s.second && !!co;
  // everything left before Sign works, in the order they appear on the page
  const left = [
    ...todo,
    ...(todo.length === 0
      ? [
          !s.agree && "tick the box to agree",
          s.typed.trim().length < 3 && "type your full name",
          !s.image &&
            "draw your signature, or sign with your typed name (a short mark doesn't count)",
          second &&
            s.typed2.trim().length < 3 &&
            `${co?.first || "the second owner"} types their name`,
          second && !s.image2 && `${co?.first || "the second owner"} signs`,
        ].filter((x): x is string => !!x)
      : []),
  ];

  return (
    <div className="space-y-6" data-sign>
      <div>
        <h3 className="font-display text-lg font-semibold">Authorization</h3>
        <div
          tabIndex={0}
          className="mt-3 max-h-56 overflow-y-auto rounded-2xl bg-white p-5 text-[0.8rem] leading-relaxed text-smoke ring-1 ring-line"
        >
          {CONSENT_TEXT}
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-sand p-4 text-sm ring-1 ring-line">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={s.agree}
            onChange={(e) => set({ agree: e.target.checked })}
          />
          <span>
            I've read and agree to the authorization above, I agree to sign electronically, and the
            information in this application is true and complete.
          </span>
        </label>
      </div>

      <SignerBlock
        title={co ? `${owner.first || "Owner"} signs` : "Sign"}
        name={`${owner.first} ${owner.last}`.trim()}
        typed={s.typed}
        setTyped={(v) => set({ typed: v })}
        setImage={(v) => set({ image: v })}
        today={today}
      />

      {co && (
        <div className="rounded-2xl bg-sand p-4 ring-1 ring-line">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5"
              checked={s.second}
              onChange={(e) =>
                set(
                  e.target.checked ? { second: true } : { second: false, typed2: "", image2: null },
                )
              }
            />
            {co.first || "The second owner"} is here and signs now too
          </label>
          <p className="mt-1 pl-8 text-xs text-smoke">
            Optional. If not, your rep will get their signature separately.
          </p>
          {second && (
            <div className="mt-4">
              <SignerBlock
                title={`${co.first || "Second owner"} signs`}
                name={`${co.first} ${co.last}`.trim()}
                typed={s.typed2}
                setTyped={(v) => set({ typed2: v })}
                setImage={(v) => set({ image2: v })}
                today={today}
              />
            </div>
          )}
        </div>
      )}

      <p
        className={cn(
          "rounded-2xl bg-sand p-4 text-sm text-smoke ring-1 ring-line",
          left.length === 0 && "sr-only",
        )}
        role="status"
        aria-live="polite"
      >
        {left.length ? `Still needed before you can sign: ${left.join(", ")}.` : "Ready to sign."}
      </p>
      {error && (
        <p className="text-sm font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        aria-disabled={left.length > 0}
        onClick={onSign}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-full bg-leaf px-6 py-4 text-base font-semibold text-ink shadow-[0_10px_30px_-12px_oklch(0.615_0.117_150/0.9)] transition hover:-translate-y-0.5 hover:brightness-105 disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-60",
        )}
      >
        <PenLine className="size-5" /> {busy ? "Signing…" : cta}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-smoke">
        <Lock className="size-3.5" /> Shared only with Lamp and the funding partners reviewing your
        application, as the authorization above says.
      </p>
    </div>
  );
}

function SignerBlock({
  title,
  name,
  typed,
  setTyped,
  setImage,
  today,
}: {
  title: string;
  name: string;
  typed: string;
  setTyped: (v: string) => void;
  setImage: (v: string | null) => void;
  today: string;
}) {
  return (
    <div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
        <F label={name ? `Type your full name (${name})` : "Type your full name"}>
          <input
            className={cn(inputCls, "font-semibold")}
            value={typed}
            placeholder="Type your full name"
            autoComplete="name"
            onChange={(e) => setTyped(e.target.value)}
          />
        </F>
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-semibold text-smoke">Date</span>
          <p className="rounded-xl px-1 py-3 text-[0.95rem] font-semibold tabular-nums">{today}</p>
        </div>
      </div>
      <p className="mb-2 mt-4 text-[0.8rem] font-semibold text-smoke">Draw your signature</p>
      <SignaturePad
        label={`Signature for ${name || "the owner"}`}
        typed={typed}
        onChange={setImage}
      />
    </div>
  );
}
