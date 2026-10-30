import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Lock, PhoneCall, Trash2, Users } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";

/**
 * Notes & calls on a file (migration 20261029140000_file_notes_and_calls.sql): a running thread in
 * place of the single staff-notes box. A note is "Team" (the file's rep and admins) or "Admins
 * only" (reps never get it, the database refuses). An admin can make a note a call for a rep, with
 * an optional due date: the rep is notified, and marks it done with what happened. Notes are kept
 * as written; only an admin removes one. Merchants see none of it.
 */

export type FileNote = {
  id: number;
  application_id: string | null;
  lead_id: string | null;
  visibility: "team" | "admins";
  body: string;
  author_name: string | null;
  assigned_to: string | null;
  due_on: string | null;
  status: "open" | "done" | null;
  done_at: string | null;
  done_by_name: string | null;
  outcome: string | null;
  created_at: string;
};

type Rep = { slug: string; name: string };

const COLUMNS =
  "id,application_id,lead_id,visibility,body,author_name,assigned_to,due_on,status,done_at,done_by_name,outcome,created_at";

const today = () => new Date().toISOString().slice(0, 10);
const dueLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function NotesCalls({
  fileId,
  leadId,
  isAdmin,
  repSlug,
  reps,
  fileRep,
  onUnavailable,
  onFileChanged,
}: {
  /** the file's thread (it includes notes carried over from the lead it came from) */
  fileId?: string;
  /** or a lead's thread, before they sign (20261029150000_lead_profiles_notes.sql) */
  leadId?: string;
  isAdmin: boolean;
  repSlug: string | null;
  reps: Rep[];
  fileRep: string | null;
  /** the thread's table isn't there yet (its SQL hasn't run): the file shows the old notes box */
  onUnavailable: () => void;
  /** a call moved the file to another rep */
  onFileChanged: () => void;
}) {
  const [notes, setNotes] = useState<FileNote[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"team" | "admins">("team");
  const [callFor, setCallFor] = useState("");
  const [due, setDue] = useState("");
  const [outcomes, setOutcomes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: err } = await sb
      .from("file_notes")
      .select(COLUMNS)
      .eq(leadId ? "lead_id" : "application_id", leadId ?? fileId ?? "")
      .order("created_at", { ascending: false });
    if (err) {
      if (err.code === "PGRST205" || err.code === "42P01") onUnavailable();
      else setError("Couldn't load the notes. Refresh to try again.");
      setNotes([]);
      return;
    }
    setNotes(data as FileNote[]);
  }, [fileId, leadId, onUnavailable]);

  useEffect(() => {
    setNotes(null);
    setBody("");
    setCallFor("");
    setDue("");
    setVisibility("team");
    void load();
  }, [load]);

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "";

  async function add() {
    const sb = getSupabase();
    const text = body.trim();
    if (!sb || !text) return;
    setBusy("add");
    setError("");
    const row = {
      ...(leadId ? { lead_id: leadId } : { application_id: fileId }),
      body: text,
      visibility: callFor ? "team" : visibility,
      ...(callFor ? { assigned_to: callFor, due_on: due || null } : {}),
    };
    const { error: err } = await sb.from("file_notes").insert(row as never);
    setBusy(null);
    if (err) {
      setError(`That note wasn't saved: ${err.message}`);
      return;
    }
    const moved = !!callFor && callFor !== fileRep;
    setBody("");
    setCallFor("");
    setDue("");
    await load();
    if (moved) onFileChanged();
  }

  async function finish(n: FileNote, done: boolean) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(`done:${n.id}`);
    setError("");
    const { data, error: err } = await sb
      .from("file_notes")
      .update({
        status: done ? "done" : "open",
        outcome: outcomes[n.id] ?? n.outcome ?? null,
      } as never)
      .eq("id", n.id)
      .select("id");
    setBusy(null);
    if (err || !data?.length) {
      setError(
        err
          ? `Couldn't update that call: ${err.message}`
          : "Only the rep it's for or an admin can do that.",
      );
      return;
    }
    await load();
  }

  async function remove(n: FileNote) {
    const sb = getSupabase();
    if (!sb || !confirm("Remove this note for everyone? It can't be brought back.")) return;
    setBusy(`del:${n.id}`);
    const { error: err } = await sb.from("file_notes").delete().eq("id", n.id);
    setBusy(null);
    if (err) setError(`Couldn't remove it: ${err.message}`);
    await load();
  }

  const moving = !!callFor && callFor !== fileRep;

  return (
    <div className="mt-5" data-notes-calls>
      <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
        Notes &amp; calls (never shown to the merchant)
      </p>

      <div className="mt-2 rounded-xl bg-white p-3 ring-1 ring-line">
        <textarea
          aria-label="New note"
          className="min-h-20 w-full resize-y bg-transparent text-sm outline-none"
          placeholder={
            isAdmin
              ? "Add a note, or an instruction for a rep (pick them below)…"
              : "Add a note for the team…"
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          {isAdmin && (
            <>
              <div
                className="inline-flex overflow-hidden rounded-full ring-1 ring-line"
                role="group"
                aria-label="Who sees it"
              >
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 px-3 py-1.5 text-xs",
                    visibility === "team" && !callFor ? "bg-ink text-white" : "text-smoke",
                  )}
                  onClick={() => setVisibility("team")}
                  disabled={!!callFor}
                >
                  <Users className="size-3.5" /> Team
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 px-3 py-1.5 text-xs",
                    visibility === "admins" && !callFor ? "bg-ink text-white" : "text-smoke",
                  )}
                  onClick={() => setVisibility("admins")}
                  disabled={!!callFor}
                  title="Only admins see it. Reps never do."
                >
                  <Lock className="size-3.5" /> Admins only
                </button>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs text-smoke">
                <PhoneCall className="size-3.5" /> Call for
                <select
                  aria-label="Make it a call for a rep"
                  className="rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                  value={callFor}
                  onChange={(e) => setCallFor(e.target.value)}
                >
                  <option value="">nobody (just a note)</option>
                  {reps.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {callFor && (
                <label className="inline-flex items-center gap-1.5 text-xs text-smoke">
                  due
                  <input
                    type="date"
                    className={cn(input, "w-auto py-1 text-xs")}
                    min={today()}
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <button
            type="button"
            className={cn(btnPrimary, "ml-auto px-4 py-1.5 text-sm")}
            disabled={!body.trim() || busy === "add"}
            onClick={() => void add()}
          >
            {busy === "add" && <Loader2 className="size-4 animate-spin" />}
            {callFor
              ? `Assign call to ${repName(callFor)}`
              : visibility === "admins" && isAdmin
                ? "Add admins-only note"
                : "Add note"}
          </button>
        </div>
        {moving && (
          <p className="mt-2 text-xs text-smoke">
            {fileRep
              ? `This ${leadId ? "lead" : "file"} is ${repName(fileRep)}'s; assigning the call gives it to ${repName(callFor)}.`
              : `This also gives the ${leadId ? "lead" : "file"} to ${repName(callFor)}.`}{" "}
            They get a notification right away.
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {notes === null ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="size-5 animate-spin text-smoke" />
        </div>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-sm text-smoke">No notes yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => {
            const call = n.status !== null;
            const mineToDo = call && (isAdmin || (!!repSlug && n.assigned_to === repSlug));
            const overdue = n.status === "open" && n.due_on && n.due_on < today();
            return (
              <li
                key={n.id}
                data-note={n.id}
                className={cn(
                  "rounded-xl px-4 py-3 text-sm ring-1",
                  n.visibility === "admins"
                    ? "bg-amber-500/10 ring-amber-500/40"
                    : "bg-white ring-line",
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-smoke">
                  <b className="text-ink">{n.author_name || "Lamp"}</b>
                  <span>{age(n.created_at)} ago</span>
                  {!leadId && n.lead_id && (
                    <span
                      className="rounded-full bg-sand px-2 py-0.5"
                      title="Written on their lead profile, before they signed"
                    >
                      before sign-up
                    </span>
                  )}
                  {n.visibility === "admins" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-600">
                      <Lock className="size-3" /> Admins only
                    </span>
                  )}
                  {call && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                        n.status === "done"
                          ? "bg-leaf/20 text-forest"
                          : overdue
                            ? "bg-red-500/15 text-red-600"
                            : "bg-sand text-ink",
                      )}
                    >
                      <PhoneCall className="size-3" /> Call for {repName(n.assigned_to)}
                      {n.due_on && ` · due ${dueLabel(n.due_on)}`}
                      {n.status === "done" ? " · done" : overdue ? " · overdue" : " · open"}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="ml-auto text-smoke hover:text-destructive"
                      aria-label="Remove note"
                      title="Remove this note"
                      disabled={busy === `del:${n.id}`}
                      onClick={() => void remove(n)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-line">{n.body}</p>
                {n.status === "done" && (
                  <p className="mt-2 rounded-lg bg-leaf/10 px-3 py-2 text-xs">
                    <b>{n.done_by_name || "Done"}</b>
                    {n.done_at && ` · ${age(n.done_at)} ago`}
                    {n.outcome ? `: ${n.outcome}` : ""}
                  </p>
                )}
                {n.status === "open" && mineToDo && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className={cn(input, "min-w-[14rem] flex-1 py-1.5 text-xs")}
                      placeholder="What happened? (shows to whoever asked)"
                      value={outcomes[n.id] ?? ""}
                      onChange={(e) => setOutcomes((o) => ({ ...o, [n.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className={cn(btnOutline, "px-3 py-1.5 text-xs")}
                      disabled={busy === `done:${n.id}`}
                      onClick={() => void finish(n, true)}
                    >
                      <Check className="size-3.5" /> Mark done
                    </button>
                  </div>
                )}
                {n.status === "done" && mineToDo && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-smoke underline"
                    onClick={() => void finish(n, false)}
                  >
                    Reopen
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type OpenCall = Pick<
  FileNote,
  | "id"
  | "application_id"
  | "lead_id"
  | "body"
  | "author_name"
  | "assigned_to"
  | "due_on"
  | "created_at"
> & {
  applications: { business_name: string | null; first_name: string | null } | null;
  leads: { first_name: string | null; answers: { lastName?: string } | null } | null;
};

/** Open calls at the top of Files: a rep's own, or (for an admin) everyone's, due soonest first. */
export function MyCalls({
  isAdmin,
  repSlug,
  reps,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: Rep[];
}) {
  const [calls, setCalls] = useState<OpenCall[] | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      let q = sb
        .from("file_notes")
        .select(
          "id,application_id,lead_id,body,author_name,assigned_to,due_on,created_at,applications(business_name,first_name),leads(first_name,answers)",
        )
        .eq("status", "open");
      if (!isAdmin && repSlug) q = q.eq("assigned_to", repSlug);
      const { data, error } = await q
        .order("due_on", { ascending: true, nullsFirst: false })
        .limit(50);
      if (live) setCalls(error ? [] : (data as unknown as OpenCall[]));
    })();
    return () => {
      live = false;
    };
  }, [isAdmin, repSlug]);

  if (!calls || calls.length === 0) return null;
  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "";
  return (
    <section className={cn(card, "mt-6 p-5")} data-my-calls>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <PhoneCall className="size-4" /> {isAdmin ? "Open calls" : "Your calls"}
        <span className="text-sm font-normal text-smoke">· {calls.length} open</span>
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {calls.map((c) => {
          const overdue = c.due_on && c.due_on < today();
          return (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              {c.application_id ? (
                <Link
                  to="/staff"
                  search={{ file: c.application_id }}
                  className="font-semibold hover:underline"
                >
                  {c.applications?.business_name || c.applications?.first_name || "A file"}
                </Link>
              ) : (
                <Link
                  to="/staff"
                  search={{ lead: c.lead_id ?? undefined }}
                  className="font-semibold hover:underline"
                >
                  {[c.leads?.first_name, c.leads?.answers?.lastName].filter(Boolean).join(" ") ||
                    "A lead"}
                  <span className="ml-1 text-xs font-normal text-smoke">(lead)</span>
                </Link>
              )}
              {isAdmin && <span className="text-xs text-smoke">for {repName(c.assigned_to)}</span>}
              <span
                className={cn("text-xs", overdue ? "font-semibold text-red-600" : "text-smoke")}
              >
                {c.due_on
                  ? `${overdue ? "overdue · was due" : "due"} ${dueLabel(c.due_on)}`
                  : "no due date"}
              </span>
              <span className="min-w-0 flex-1 truncate text-smoke">
                {c.author_name ? `${c.author_name}: ` : ""}
                {c.body}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
