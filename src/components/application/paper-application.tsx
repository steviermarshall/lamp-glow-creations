import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, PenLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BANKRUPTCY,
  cleanDetails,
  CONSENT_VERSION,
  detailsToPdf,
  emptyDetails,
  fromRow,
  missing,
  US_STATES,
  type Details,
} from "@/lib/application-details";
import { amount } from "@/lib/real-estate";
import { applicationPdfBytes, CHECKBOXES, downloadApplicationPdf } from "@/lib/application-pdf";
import {
  BLANK_APPLICATION_PDF,
  EMAIL_RE,
  saveClaim,
  type OpenResponse,
  type SubmitResponse,
} from "@/lib/application-links";
import {
  boxOf,
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
import { PageShell } from "@/components/site/layout";
import { SignBlock } from "@/components/application/sign-block";
import { emptySigning, YES_NO, type Signing } from "@/components/application/form-kit";
import { Choice, F, inputCls, Select } from "@/components/application/fields";
import { DoneScreen, Statements, type Done } from "@/components/application/link-application";

/**
 * The paper application on the page (getlamp.app/application/<rep>/pdf): the printed form with a
 * box to type in over every box on it, the two answers the form has no room for, statements, and
 * the same signing step as the online application. On a wide screen the boxes are typed into in
 * place; on a phone a tap opens the box in a large editor at the top, with Next through the form.
 * Signing sends it the way the online link does (form "pdf"), so it lands in the rep's files.
 */

/** Below this width (CSS px) the page's boxes are too small to type into: tap to edit. */
const TAP_MODE_WIDTH = 640;
/** Typing pauses this long before the contact boxes are sent or a section counts as done. */
const SETTLE_MS = 2500;
/** Saved in this browser while they fill it in; never the SSN or date of birth. */
const draftKey = (rep: string) => `lamp.paper.v1.${rep}`;

function loadDraft(rep: string): Details | null {
  try {
    const raw = window.localStorage.getItem(draftKey(rep));
    return raw ? fromRow(JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function saveDraft(rep: string, d: Details) {
  try {
    const safe = { ...d, owners: d.owners.map((o) => ({ ...o, ssn: "", dob: "" })) };
    window.localStorage.setItem(draftKey(rep), JSON.stringify(safe));
  } catch {
    /* private mode or full storage: they just won't get it back after a reload */
  }
}

function clearDraft(rep: string) {
  try {
    window.localStorage.removeItem(draftKey(rep));
  } catch {
    /* nothing saved */
  }
}

export function PaperApplication({ repSlug }: { repSlug: string }) {
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
  const honeypot = useRef<HTMLInputElement | null>(null);
  const signRef = useRef<HTMLDivElement | null>(null);

  // the application is always the light look, like the online one
  useEffect(() => {
    document.documentElement.dataset["theme"] = "light";
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/application/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rep: repSlug }),
        });
        const o = (await res.json().catch(() => null)) as OpenResponse | null;
        if (!live) return;
        if (!res.ok || !o || typeof o.state !== "string") return setOpen("error");
        setOpen(o);
        const saved = o.state === "open" ? loadDraft(repSlug) : null;
        if (saved) setD(saved);
      } catch {
        if (live) setOpen("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [repSlug]);

  const update = (next: Details) => {
    setD(next);
    saveDraft(repSlug, next);
  };

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
  useEffect(() => {
    if (!contactKey || captured.current || open === null || open === "error") return;
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
      void fetch("/api/application/start", {
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
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { progress?: unknown } | null) => {
          if (typeof j?.progress === "string") {
            saveProgressToken(repSlug, j.progress);
            setTokenReady(true);
          } else captured.current = false;
        })
        .catch(() => {
          captured.current = false;
        });
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [contactKey, open, repSlug]);

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

  async function submit() {
    setError("");
    setTried(true);
    const clean = cleanDetails(tidy);
    const owner = clean.owners[0]!;
    if (todo.length) return setError("Fill in the boxes marked in red on the form, then sign.");
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
          token: null,
          rep: repSlug,
          form: "pdf",
          details: clean,
          signature: {
            name: signed.name,
            image: signed.image,
            name2: signed.name2,
            image2: signed.image2,
          },
          consent_version: CONSENT_VERSION,
          company_fax: honeypot.current?.value ?? "",
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
    clearDraft(repSlug);

    // the signed PDF, with what the database stamped, goes with the file for funders; if this
    // fails staff build the same PDF from the saved answers
    const stamped = { ...signed, at: out.signed_at ?? signed.at, ip: out.signer_ip ?? null };
    const values = detailsToPdf(clean, stamped, rep?.name ?? null);
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
    try {
      const bytes = await applicationPdfBytes(src, values, "lender");
      await upload(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        "Signed application.pdf",
        "funder_application",
      );
    } catch {
      /* staff build it from the saved answers */
    }
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
        body: JSON.stringify({ application_id: out.application_id, claim_token: out.claim_token }),
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
                Tap any box on the form to fill it in. Your name and number go to {repFirst} once
                you enter them, so they can help if you get stuck. Prefer paper?{" "}
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
            </div>

            <PaperPage
              d={d}
              update={update}
              wrong={wrong}
              sig={sig}
              repName={rep?.name ?? ""}
              onSignBox={() =>
                signRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />

            <section className="mt-6 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7">
              <h2 className="font-display text-lg font-semibold">Two more questions</h2>
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
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7">
              <h2 className="font-display text-lg font-semibold">
                Bank statements <span className="text-sm font-normal text-smoke">optional</span>
              </h2>
              <div className="mt-3">
                <Statements files={files} setFiles={setFiles} />
              </div>
            </section>

            <div
              ref={signRef}
              className="mt-6 scroll-mt-24 rounded-[1.5rem] bg-white p-5 ring-1 ring-line sm:p-7"
            >
              <SignBlock
                d={tidy}
                s={sig}
                set={(patch) => setSig((x) => ({ ...x, ...patch }))}
                todo={todo}
                error={error}
                busy={busy}
                onSign={() => void submit()}
                cta={`Sign and send to ${repFirst}`}
              />
            </div>
            <input
              ref={honeypot}
              name="company_fax"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />
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
}: {
  d: Details;
  update: (d: Details) => void;
  wrong: Set<string>;
  sig: Signing;
  repName: string;
  onSignBox: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tap, setTap] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

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
                wrong={item.kind === "field" && wrong.has(item.id)}
                onOpen={() => setEditing(i)}
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
              <InPlaceGroup key={item.id} item={item} d={d} update={update} />
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
          onMove={setEditing}
          onClose={() => setEditing(null)}
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
}: {
  item: PaperGroup;
  d: Details;
  update: (d: Details) => void;
}) {
  const on = item.get(d);
  return (
    <>
      {item.choices.map((c) => {
        const checked = on.includes(c.value);
        return (
          <button
            key={c.box}
            type="button"
            role={item.multi ? "checkbox" : "radio"}
            aria-checked={checked}
            aria-label={`${item.label}: ${c.label}`}
            className="absolute grid place-items-center rounded-[0.2cqw] hover:bg-leaf/20"
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
          className="absolute rounded-[0.3cqw] bg-leaf/10 ring-1 ring-leaf/40"
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
  onMove,
  onClose,
}: {
  index: number;
  d: Details;
  update: (d: Details) => void;
  onMove: (i: number) => void;
  onClose: () => void;
}) {
  const item = PAPER_ITEMS[index]!;
  const last = PAPER_ITEMS.length - 1;
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
              ref={(el) => {
                inputRef.current = el;
              }}
              className={inputCls}
              {...inputProps(item)}
              value={item.get(d)}
              enterKeyHint={index < last ? "next" : "done"}
              onChange={(e) => update(item.set(d, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (index < last) onMove(index + 1);
                  else onClose();
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
          <span className="text-xs text-smoke tabular-nums">
            {index + 1} of {PAPER_ITEMS.length}
          </span>
          {index < last ? (
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              onClick={() => onMove(index + 1)}
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
