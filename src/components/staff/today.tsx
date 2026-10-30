import { useEffect, useState } from "react";
import { FollowUp } from "@/components/staff/follow-up";
import { Link } from "@tanstack/react-router";
import { ArrowRight, PenLine, Sparkles, Sun } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { STAGE_LABEL, isStage } from "@/lib/staff";
import type { Signal } from "@/lib/brain";

/**
 * Today (Lamp Brain, slice 1): the files and links that need the signed-in staff member most, best
 * first, each with its next step. Lamp's server works the list out by rules
 * (src/lib/brain.ts via /api/brain/brief); when the Anthropic key is set, Claude writes the
 * headline and the steps once a day, marked with a spark. Draft on a line opens a follow-up text,
 * email and call notes for it (follow-up.tsx). Shows nothing when nothing needs doing.
 */

type Item = {
  id: string;
  kind: "file" | "link";
  business: string;
  stage: string | null;
  rep_slug: string | null;
  signal: Signal;
  label: string;
  next: string;
  written: boolean;
};
type Brief = {
  day: string;
  mode: "ai" | "rules";
  reason: "off" | "busy" | "failed" | "cap" | null;
  headline: string | null;
  items: Item[];
  switch?: "on" | "off";
  spend?: number;
  cap?: number;
};

const URGENT: Signal[] = ["offer_expiring", "active_now"];

async function get<T>(query = ""): Promise<T> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch(`/api/brain/brief${query}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

const ADMIN_NOTE: Record<string, string> = {
  off: "Written by Lamp's rules. Claude writes this list once the Anthropic key is added in the server's secrets.",
  cap: "Written by Lamp's rules: this month's Claude budget is used up.",
  failed:
    "Written by Lamp's rules: Claude couldn't write today's list. It tries again within the hour.",
  busy: "Claude is writing today's list. Reload in a minute.",
};

export function Today({
  isAdmin,
  reps,
}: {
  isAdmin: boolean;
  reps: { slug: string; name: string }[];
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    get<Brief>()
      .then((b) => live && setBrief(b))
      .catch(() => live && setBrief(null));
    return () => {
      live = false;
    };
  }, []);

  if (!brief || brief.items.length === 0) return null;
  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "";
  const note = isAdmin && brief.mode === "rules" && brief.reason ? ADMIN_NOTE[brief.reason] : null;
  return (
    <section className={cn(card, "mt-6 p-5")} data-today>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Sun className="size-4" /> Today
        <span className="text-sm font-normal text-smoke">
          · {brief.items.length} {brief.items.length === 1 ? "thing" : "things"} to do
        </span>
      </h2>
      {brief.headline && (
        <p className="mt-2 flex items-start gap-2 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-forest" aria-label="Written by Claude" />
          {brief.headline}
        </p>
      )}
      <ol className="mt-3 divide-y divide-line">
        {brief.items.map((i) => (
          <li key={`${i.kind}:${i.id}`} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {i.kind === "file" ? (
                <Link to="/staff" search={{ file: i.id }} className="font-semibold hover:underline">
                  {i.business}
                </Link>
              ) : (
                <Link
                  to="/staff"
                  search={{ view: "sent" }}
                  className="font-semibold hover:underline"
                >
                  {i.business}
                  <span className="ml-1 text-xs font-normal text-smoke">(link)</span>
                </Link>
              )}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  URGENT.includes(i.signal)
                    ? "bg-red-500/15 font-semibold text-red-500"
                    : "bg-sand",
                )}
              >
                {i.label}
              </span>
              {i.stage && isStage(i.stage) && (
                <span className="text-xs text-smoke">{STAGE_LABEL[i.stage]}</span>
              )}
              {isAdmin && i.rep_slug && (
                <span className="text-xs text-smoke">{repName(i.rep_slug)}</span>
              )}
              <DraftToggle
                open={open === `${i.kind}:${i.id}`}
                onClick={() =>
                  setOpen((o) => (o === `${i.kind}:${i.id}` ? null : `${i.kind}:${i.id}`))
                }
              />
            </div>
            <p className="mt-0.5 flex items-start gap-1.5 text-smoke">
              {i.written ? (
                <Sparkles
                  className="mt-0.5 size-3.5 shrink-0 text-forest"
                  aria-label="Written by Claude"
                />
              ) : (
                <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              )}
              {i.next}
            </p>
            {open === `${i.kind}:${i.id}` && <FollowUp kind={i.kind} id={i.id} />}
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 text-xs text-smoke">{note}</p>}
      {isAdmin && brief.mode === "ai" && brief.spend !== undefined && (
        <p className="mt-3 text-xs text-smoke">
          Written by Claude this morning · ${brief.spend.toFixed(2)} of ${brief.cap ?? 50} this
          month
        </p>
      )}
    </section>
  );
}

/** One file's next step, for the top of the file view. Nothing when the file needs nothing today. */
export function NextStep({ fileId }: { fileId: string }) {
  const [item, setItem] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setItem(null);
    setOpen(false);
    get<{ next: Item | null }>(`?file=${encodeURIComponent(fileId)}`)
      .then((r) => live && setItem(r.next))
      .catch(() => live && setItem(null));
    return () => {
      live = false;
    };
  }, [fileId]);

  if (!item) return null;
  return (
    <div className="mt-3">
      <p
        className={cn(
          "flex flex-wrap items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1",
          URGENT.includes(item.signal) ? "bg-red-500/10 ring-red-500/40" : "bg-sand/60 ring-line",
        )}
        data-next-step
      >
        {item.written ? (
          <Sparkles className="mt-0.5 size-4 shrink-0 text-forest" aria-label="Written by Claude" />
        ) : (
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Do this next · {item.label}.</span> {item.next}
        </span>
        <DraftToggle open={open} onClick={() => setOpen((o) => !o)} />
      </p>
      {open && <FollowUp kind="file" id={fileId} />}
    </div>
  );
}

function DraftToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-forest hover:underline"
      aria-expanded={open}
      onClick={onClick}
      data-draft
    >
      <PenLine className="size-3.5" /> {open ? "Close draft" : "Draft"}
    </button>
  );
}
