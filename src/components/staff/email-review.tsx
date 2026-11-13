import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, Clock, Loader2, RefreshCw, Send, X } from "lucide-react";

import { getSupabase } from "@/lib/supabase";
import { card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import { cn } from "@/lib/utils";
import {
  reviewCard,
  senderLabel,
  stageLabel,
  type Decision,
  type Item,
  type StepState,
  type Tone,
} from "@/lib/engine-outbox";

/**
 * Staff > Email engine, for admins: the emails the engine wants to send, waiting for a person.
 * One card. An admin reads the emails, leaves out any they don't want, and presses Send; the engine
 * then sends the approved ones from each person's own mailbox and this card shows each one go out.
 *
 * The approval is the button and nothing else: decide() below is called only from a click, the
 * server checks the caller is an admin, and the engine sends only what the server marked approved.
 */

type Load = { items: Item[] };
type Decided = Load & { changed: number; asked: number };

async function call<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch("/api/engine/review", {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

const PILL: Record<Tone, string> = {
  ready: "bg-leaf/20 text-forest",
  working: "bg-sand text-ink",
  attention: "bg-sand text-ink",
  done: "bg-sand text-ink",
  failed: "bg-red-100 text-red-800",
};

function StepIcon({ state }: { state: StepState }) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (state === "done") return <Check className={cn(cls, "text-forest")} aria-hidden />;
  if (state === "active")
    return <Loader2 className={cn(cls, "text-ink motion-safe:animate-spin")} aria-hidden />;
  if (state === "failed" || state === "attention")
    return <CircleAlert className={cn(cls, "text-red-700")} aria-hidden />;
  return <Clock className={cn(cls, "text-smoke")} aria-hidden />;
}

const STATUS_WORDS: Record<Item["status"], string> = {
  pending: "Waiting for you",
  approved: "Approved, going out",
  skipped: "Left out",
  sent: "Sent",
  failed: "Not sent",
  withdrawn: "Taken back by the engine",
};

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

export type EmailReviewCardProps = {
  /** The emails, or null while they are still arriving. */
  items: Item[] | null;
  error: string;
  note: string;
  /** True while a press is on its way to the server. */
  busy: boolean;
  /** Called only from a press. */
  onAct: (action: Decision, ids: string[]) => void;
  onRefresh: () => void;
};

/** The card itself: everything it shows comes from `items`, through reviewCard(). */
export function EmailReviewCard({
  items,
  error,
  note,
  busy,
  onAct,
  onRefresh,
}: EmailReviewCardProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLElement>(null);
  const view = useMemo(() => reviewCard(items ?? []), [items]);
  // when the main button goes away (approved, or nothing left to press), the card takes the keyboard
  // focus itself, so it never falls off the page
  const hadPrimary = useRef(false);
  useEffect(() => {
    const has = !!view.primary;
    const el = root.current;
    if (hadPrimary.current && !has && el) {
      const at = document.activeElement;
      if (!at || at === document.body || el.contains(at)) el.focus();
    }
    hadPrimary.current = has;
  }, [view.primary]);

  if (items === null)
    return (
      <section
        className={cn(card, "mt-6 p-5")}
        data-agent-card
        data-tone="working"
        data-loading
        tabIndex={-1}
        aria-busy="true"
      >
        <div className="h-6 w-64 max-w-full rounded-full bg-sand" />
        <div className="mt-3 h-4 w-48 max-w-full rounded-full bg-sand" />
        <div className="mt-5 h-4 w-full rounded-full bg-sand" />
        <div className="mt-2 h-4 w-3/4 rounded-full bg-sand" />
        <div className="mt-5 h-11 w-44 rounded-full bg-sand" />
        <span className="sr-only">Loading the emails waiting for approval.</span>
      </section>
    );

  const shown = items.filter((i) => i.status !== "withdrawn");
  const groups = new Map<string, Item[]>();
  for (const i of shown) groups.set(i.sender_email, [...(groups.get(i.sender_email) ?? []), i]);
  const anyClosed = shown.some((i) => !open[i.id]);

  return (
    <section
      ref={root}
      className={cn(card, "mt-6 p-5 outline-none focus-visible:ring-2 focus-visible:ring-forest")}
      data-agent-card
      data-tone={view.tone}
      data-email-review
      tabIndex={-1}
      aria-labelledby="email-review-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="email-review-title" className="font-display text-lg font-semibold">
            {view.title}
          </h2>
          {view.subtitle && <p className="mt-0.5 text-sm text-smoke">{view.subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[view.tone])}
            data-email-review-pill
          >
            {view.pill}
          </span>
          <button type="button" className={cn(chip, "min-h-11 gap-2 px-4")} onClick={onRefresh}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {view.steps.length > 0 && (
        <ol className="mt-4 space-y-2">
          {view.steps.map((s) => (
            <li key={s.key} className="flex gap-2 text-sm" data-step data-state={s.state}>
              <StepIcon state={s.state} />
              <span className="min-w-0 break-words">
                <span className="font-semibold">{s.title}</span>
                <span className="text-smoke">: {s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-sm text-smoke" data-now>
        {view.next}
      </p>
      {note && (
        <p className="mt-3 rounded-xl bg-sand px-4 py-3 text-sm text-ink" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-100 px-4 py-3 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}

      {view.primary && (
        <button
          type="button"
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-leaf px-6 py-2.5 text-sm font-semibold text-ink transition hover:brightness-105 aria-busy:opacity-70"
          data-primary
          aria-busy={busy}
          onClick={() => {
            if (!busy) onAct(view.primary!.action, view.primary!.ids);
          }}
        >
          {busy ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {view.primary.label}
        </button>
      )}

      {shown.length > 0 && (
        <div className="mt-6 border-t border-line pt-4" data-email-review-list>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold">The emails</h3>
            <button
              type="button"
              className={cn(chip, "min-h-11 px-4")}
              onClick={() =>
                setOpen(anyClosed ? Object.fromEntries(shown.map((i) => [i.id, true])) : {})
              }
            >
              {anyClosed ? "Open all" : "Close all"}
            </button>
          </div>
          {[...groups.entries()].map(([mailbox, rows]) => (
            <div key={mailbox} className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
                From {senderLabel(rows[0]!)} · {mailbox}
              </p>
              <ul className="mt-2 space-y-2">
                {rows.map((i) => {
                  const isOpen = !!open[i.id];
                  return (
                    <li
                      key={i.id}
                      className={cn(
                        "rounded-xl border border-line px-4 py-3",
                        i.status === "skipped" && "bg-sand",
                      )}
                      data-email
                      data-email-status={i.status}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold">
                            {i.business || i.to_email}
                          </p>
                          <p className="break-words text-xs text-smoke">
                            To {i.to_email} · {stageLabel(i.stage)}
                          </p>
                          <p className="mt-1 break-words text-sm">{i.subject}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-smoke" data-email-state>
                            {STATUS_WORDS[i.status]}
                            {i.status === "sent" && i.sent_at ? ` ${clock(i.sent_at)}` : ""}
                          </span>
                          {i.status === "pending" && (
                            <button
                              type="button"
                              className={cn(chip, "min-h-11 gap-1 px-4")}
                              aria-disabled={busy}
                              onClick={() => {
                                if (!busy) onAct("skip", [i.id]);
                              }}
                            >
                              <X className="size-4" aria-hidden />
                              Leave out
                            </button>
                          )}
                          {i.status === "skipped" && (
                            <button
                              type="button"
                              className={cn(chip, "min-h-11 px-4")}
                              aria-disabled={busy}
                              onClick={() => {
                                if (!busy) onAct("restore", [i.id]);
                              }}
                            >
                              Put back
                            </button>
                          )}
                          <button
                            type="button"
                            className={cn(chip, "min-h-11 gap-1 px-4")}
                            aria-expanded={isOpen}
                            aria-controls={`email-body-${i.id}`}
                            onClick={() => setOpen((o) => ({ ...o, [i.id]: !isOpen }))}
                          >
                            <ChevronDown
                              className={cn("size-4 transition", isOpen && "rotate-180")}
                              aria-hidden
                            />
                            {isOpen ? "Close" : "Read"}
                          </button>
                        </div>
                      </div>
                      {i.status === "failed" && i.error && (
                        <p className="mt-2 break-words rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">
                          {i.error}
                        </p>
                      )}
                      {isOpen && (
                        <pre
                          id={`email-body-${i.id}`}
                          className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-sand px-4 py-3 font-sans text-sm text-ink"
                        >
                          {i.body}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The card with its data: loads the emails, looks again while approved ones are going out, and
 * carries each press to the server. A press is the only thing that calls decide().
 */
export function EmailReview() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setItems((await call<Load>("GET")).items);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the emails.");
      setItems((cur) => cur ?? []);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const going = (items ?? []).some((i) => i.status === "approved");
  useEffect(() => {
    if (!going) return;
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [going, refresh]);

  const act = async (action: Decision, ids: string[]) => {
    if (busyRef.current || !ids.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await call<Decided>("POST", { action, ids });
      setItems(r.items);
      if (r.changed < r.asked)
        setNote(
          `${r.asked - r.changed} of ${r.asked} had already been handled, so nothing changed for those.`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Nothing was changed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <EmailReviewCard
      items={items}
      error={error}
      note={note}
      busy={busy}
      onAct={(action, ids) => void act(action, ids)}
      onRefresh={() => void refresh()}
    />
  );
}
