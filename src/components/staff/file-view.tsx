import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ExternalLink, Loader2, Paperclip, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { labelFor, QUESTIONS, type Answers } from "@/lib/apply";
import { downloadApplicationPdf } from "@/lib/application-pdf";
import { detailsToPdf } from "@/lib/application-details";
import { FileApplication } from "@/components/staff/file-application";
import { RESTRICTED, revealFullApplication, useFullApplication } from "@/lib/full-application";
import {
  EVENT_LABEL,
  STAGE_LABEL,
  STAGES,
  stamp,
  type DocStatus,
  type EventKind,
  type Stage,
} from "@/lib/staff";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { FileOffers } from "@/components/staff/file-offers";

type FileRow = {
  id: string;
  status: Stage;
  rep_slug: string | null;
  answers: Answers;
  first_name: string | null;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  amount_requested: number | null;
  purpose: string | null;
  phone_consent_at: string | null;
  phone_consent_text: string | null;
  staff_notes: string | null;
  created_at: string;
  assigned_at: string | null;
  submitted_at: string | null;
  funded_at: string | null;
  closed_at: string | null;
};

type EventRow = {
  id: number;
  kind: EventKind;
  from_stage: Stage | null;
  to_stage: Stage | null;
  body: string | null;
  payload: unknown;
  actor_user_id: string | null;
  occurred_at: string;
};

type DocRow = {
  id: string;
  bucket: string;
  storage_path: string;
  original_name: string | null;
  kind: string;
  status: DocStatus;
  created_at: string;
  reviewed_at: string | null;
};

const FILE_COLUMNS =
  "id,status,rep_slug,answers,first_name,business_name,phone,email,amount_requested,purpose,phone_consent_at,phone_consent_text,staff_notes,created_at,assigned_at,submitted_at,funded_at,closed_at";
const SIGNED_URL_SECONDS = 60;

const DOC_TAG: Record<DocStatus, string> = {
  received: "To review",
  accepted: "Accepted",
  rejected: "Not accepted",
};

export function FileView({
  fileId,
  userId,
  isAdmin,
  repSlug,
  reps,
}: {
  fileId: string;
  userId: string;
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [file, setFile] = useState<FileRow | null | undefined>(undefined);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const full = useFullApplication(fileId);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    // The file first: events and documents are read only once the pipeline rules have
    // let this user open the application itself.
    const app = await sb.from("applications").select(FILE_COLUMNS).eq("id", fileId).maybeSingle();
    if (app.error || !app.data) {
      if (app.error) setError("Couldn't load this file. Refresh to try again.");
      setFile(null);
      setEvents([]);
      setDocs([]);
      return;
    }
    const [ev, dc] = await Promise.all([
      sb
        .from("events")
        .select("id,kind,from_stage,to_stage,body,payload,actor_user_id,occurred_at")
        .eq("application_id", fileId)
        .order("occurred_at", { ascending: false })
        .limit(200),
      sb
        .from("documents")
        .select("id,bucket,storage_path,original_name,kind,status,created_at,reviewed_at")
        .eq("application_id", fileId)
        .order("created_at", { ascending: false }),
    ]);
    if (ev.error || dc.error) {
      setError("Couldn't load this file. Refresh to try again.");
      setFile((f) => f ?? null);
      return;
    }
    const row = app.data as FileRow;
    setFile(row);
    setNotes(row.staff_notes ?? "");
    setEvents(ev.data as EventRow[]);
    setDocs(dc.data as DocRow[]);
    const actors = [...new Set(ev.data.map((e) => e.actor_user_id).filter(Boolean))] as string[];
    if (actors.length) {
      const { data } = await sb
        .from("profiles")
        .select("id,full_name,first_name,email")
        .in("id", actors);
      setPeople(
        new Map(
          (data ?? []).map((p) => [p.id, p.full_name || p.first_name || p.email || "Someone"]),
        ),
      );
    }
  }, [fileId]);

  useEffect(() => {
    setFile(undefined);
    setError("");
    load();
  }, [load]);

  /** Runs one write; an update the rules refuse comes back with no rows, not an error. */
  const run = async (key: string, write: () => Promise<{ ok: boolean }>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      const { ok } = await write();
      if (!ok) setError("That change wasn't saved. You may not have access to this file.");
    } catch {
      setError("That change wasn't saved. Please try again.");
    } finally {
      await load();
      setBusy(null);
    }
  };

  const updateFile = (
    key: string,
    patch: Partial<Pick<FileRow, "status" | "rep_slug" | "staff_notes">>,
  ) =>
    run(key, async () => {
      const sb = getSupabase();
      if (!sb) return { ok: false };
      const { data, error: err } = await sb
        .from("applications")
        .update(patch)
        .eq("id", fileId)
        .select("id");
      return { ok: !err && data.length === 1 };
    });

  const review = (doc: DocRow, status: "accepted" | "rejected") =>
    run(`doc:${doc.id}`, async () => {
      const sb = getSupabase();
      if (!sb) return { ok: false };
      const { data, error: err } = await sb
        .from("documents")
        .update({ status, reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("id", doc.id)
        .select("id");
      if (err || data.length !== 1) return { ok: false };
      // The document table has no timeline trigger, so the review is logged here, as the
      // signed-in user (the events policy refuses any other actor).
      await sb.from("events").insert({
        application_id: fileId,
        actor_user_id: userId,
        kind: "document_reviewed",
        body: `${status === "accepted" ? "Accepted" : "Not accepted"}: ${docName(doc)}`,
        payload: { document_id: doc.id, status },
      });
      return { ok: true };
    });

  const open = async (doc: DocRow) => {
    const sb = getSupabase();
    if (!sb) return;
    // Open the tab inside the click so it isn't blocked, then point it at the signed URL.
    const tab = window.open("about:blank", "_blank");
    const { data, error: err } = await sb.storage
      .from(doc.bucket)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
    if (err || !data) {
      tab?.close();
      setError(`Couldn't open ${docName(doc)}.`);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else {
      window.location.href = data.signedUrl;
    }
  };

  if (file === undefined) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-smoke" />
      </div>
    );
  }

  if (file === null) {
    return (
      <div className={cn(card, "mt-8 p-8 text-center")}>
        <p className="text-smoke">{error || "This file isn't one you can open."}</p>
        <Link to="/staff" className={cn(btnOutline, "mt-5 px-4 py-2.5")}>
          <ArrowLeft className="size-4" /> Back to files
        </Link>
      </div>
    );
  }

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "Unassigned";
  const mine = !!repSlug && file.rep_slug === repSlug;

  return (
    <div className="mt-6">
      <Link
        to="/staff"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-smoke hover:text-ink"
      >
        <ArrowLeft className="size-4" /> All files
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-smoke">
            {STAGE_LABEL[file.status]} · {repName(file.rep_slug)} · filed {stamp(file.created_at)}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {file.business_name || "Unnamed business"}
          </h2>
        </div>
        <button
          type="button"
          className={cn(btnOutline, "px-4 py-2.5")}
          disabled={busy === "pdf"}
          onClick={async () => {
            setBusy("pdf");
            setError("");
            try {
              // The PDF carries full SSNs, so the database logs it like Show SSN. Staff who can't
              // see the full application get the quick answers only.
              const pdfFull =
                full && full !== RESTRICTED
                  ? await revealFullApplication(fileId, "application_pdf")
                  : null;
              await downloadApplicationPdf(
                {
                  answers: file.answers,
                  first_name: file.first_name,
                  business_name: file.business_name,
                  phone: file.phone,
                  email: file.email,
                  amount_requested: file.amount_requested,
                  repName: file.rep_slug ? repName(file.rep_slug) : null,
                },
                pdfFull
                  ? detailsToPdf(
                      pdfFull.details,
                      { name: pdfFull.signedName, at: pdfFull.signedAt },
                      file.rep_slug ? repName(file.rep_slug) : null,
                    )
                  : undefined,
              );
            } catch {
              setError("Couldn't build the application PDF. Try again.");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "pdf"
            ? "Building PDF…"
            : full && full !== RESTRICTED && full.signedAt
              ? "Signed application PDF"
              : "Application PDF"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Work this file</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1.5 block text-xs text-smoke">Stage</span>
                <select
                  aria-label="Stage"
                  className="w-full rounded-full bg-white px-4 py-2 ring-1 ring-line"
                  value={file.status}
                  disabled={!!busy}
                  onChange={(e) => updateFile("stage", { status: e.target.value as Stage })}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm">
                <span className="mb-1.5 block text-xs text-smoke">Rep</span>
                {isAdmin ? (
                  <select
                    aria-label="Rep"
                    className="w-full rounded-full bg-white px-4 py-2 ring-1 ring-line"
                    value={file.rep_slug ?? ""}
                    disabled={!!busy}
                    onChange={(e) => updateFile("rep", { rep_slug: e.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {reps.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : file.rep_slug === null && repSlug ? (
                  <button
                    type="button"
                    className={cn(btnPrimary, "w-full px-4 py-2")}
                    disabled={!!busy}
                    onClick={() => updateFile("rep", { rep_slug: repSlug })}
                  >
                    Take this file
                  </button>
                ) : (
                  <p className="py-2 font-medium">
                    {repName(file.rep_slug)}
                    {mine && " (you)"}
                  </p>
                )}
              </div>
            </div>
            <label className="mt-5 block text-sm">
              <span className="mb-1.5 block text-xs text-smoke">
                Staff notes (never shown to the merchant)
              </span>
              <textarea
                aria-label="Staff notes"
                className="min-h-28 w-full rounded-xl bg-white px-4 py-3 ring-1 ring-line"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesSaved(false);
                }}
              />
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                className={cn(btnOutline, "px-4 py-2")}
                disabled={!!busy || notes === (file.staff_notes ?? "")}
                onClick={async () => {
                  await updateFile("notes", { staff_notes: notes.trim() ? notes : null });
                  setNotesSaved(true);
                }}
              >
                {busy === "notes" ? <Loader2 className="size-4 animate-spin" /> : null}
                Save notes
              </button>
              {notesSaved && notes === (file.staff_notes ?? "") && (
                <span className="text-xs text-smoke">Saved</span>
              )}
            </div>
          </section>

          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Documents</h3>
            {docs.length === 0 ? (
              <p className="mt-2 text-sm text-smoke">Nothing uploaded yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {docs.map((d) => (
                  <li
                    key={d.id}
                    data-doc={d.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-sand px-4 py-3 text-sm"
                  >
                    <Paperclip className="size-4 shrink-0 text-smoke" />
                    <button
                      type="button"
                      onClick={() => open(d)}
                      aria-label={`Open ${docName(d)}`}
                      className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:text-amber-deep"
                    >
                      <span className="truncate">{docName(d)}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </button>
                    <span className="ml-auto shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-smoke ring-1 ring-line">
                      {DOC_TAG[d.status]}
                    </span>
                    <button
                      type="button"
                      disabled={!!busy || d.status === "accepted"}
                      onClick={() => review(d, "accepted")}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-line transition hover:ring-ink/30 disabled:opacity-40"
                    >
                      <Check className="size-3.5" /> Accept
                    </button>
                    <button
                      type="button"
                      disabled={!!busy || d.status === "rejected"}
                      onClick={() => review(d, "rejected")}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-line transition hover:ring-ink/30 disabled:opacity-40"
                    >
                      <X className="size-3.5" /> Not accepted
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <FileOffers
            fileId={file.id}
            userId={userId}
            isAdmin={isAdmin}
            fileRep={file.rep_slug}
            onChange={() => void load()}
          />

          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Timeline</h3>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-smoke">No activity yet.</p>
            ) : (
              <ol className="mt-4 space-y-3">
                {events.map((e) => (
                  <li
                    key={e.id}
                    data-event-kind={e.kind}
                    className="border-l-2 border-line pl-4 text-sm"
                  >
                    <p className="font-medium">{describe(e, repName)}</p>
                    <p className="text-xs text-smoke">
                      {stamp(e.occurred_at)} ·{" "}
                      {e.actor_user_id
                        ? (people.get(e.actor_user_id) ?? "Staff")
                        : "Merchant or system"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <FileApplication fileId={fileId} full={full} />

          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Contact</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <Item label="First name">{file.first_name}</Item>
              <Item label="Business">{file.business_name}</Item>
              <Item label="Email">
                {file.email && (
                  <a className="underline" href={`mailto:${file.email}`}>
                    {file.email}
                  </a>
                )}
              </Item>
              <Item label="Phone">
                {file.phone && (
                  <a className="underline" href={`tel:${file.phone}`}>
                    {file.phone}
                  </a>
                )}
              </Item>
              <Item label="Phone consent">
                {file.phone_consent_at ? `Given ${stamp(file.phone_consent_at)}` : "Not given"}
              </Item>
              {file.phone_consent_text && (
                <Item label="Consent wording">
                  <span className="font-normal text-smoke">{file.phone_consent_text}</span>
                </Item>
              )}
            </dl>
          </section>

          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Answers</h3>
            <dl className="mt-4 space-y-3 text-sm">
              {QUESTIONS.map((q) => (
                <Item key={q.key} label={q.title}>
                  {labelFor(q.key, file.answers?.[q.key])}
                </Item>
              ))}
              {file.amount_requested !== null && (
                <Item label="Amount requested">
                  ${file.amount_requested.toLocaleString("en-US")}
                </Item>
              )}
              {file.purpose && <Item label="Purpose">{file.purpose}</Item>}
            </dl>
          </section>

          <section className={cn(card, "p-6")}>
            <h3 className="font-display text-lg font-semibold">Stamps</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <Item label="Filed">{stamp(file.created_at)}</Item>
              <Item label="Assigned">{file.assigned_at && stamp(file.assigned_at)}</Item>
              <Item label="Sent to funders">{file.submitted_at && stamp(file.submitted_at)}</Item>
              <Item label="Funded">{file.funded_at && stamp(file.funded_at)}</Item>
              <Item label="Closed">{file.closed_at && stamp(file.closed_at)}</Item>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-smoke">{label}</dt>
      <dd className="font-medium break-words">{children || "—"}</dd>
    </div>
  );
}

function docName(d: DocRow) {
  return (
    d.original_name ||
    d.storage_path.slice(d.storage_path.lastIndexOf("/") + 1).replace(/^\d+-/, "")
  );
}

function describe(e: EventRow, repName: (slug: string | null) => string) {
  if (e.kind === "stage_change") {
    return e.from_stage
      ? `${STAGE_LABEL[e.from_stage]} → ${e.to_stage ? STAGE_LABEL[e.to_stage] : "—"}`
      : `Filed as ${e.to_stage ? STAGE_LABEL[e.to_stage] : "—"}`;
  }
  if (e.kind === "assigned") {
    const p = (e.payload ?? {}) as { from?: string | null; to?: string | null };
    return `${repName(p.from ?? null)} → ${repName(p.to ?? null)}`;
  }
  return e.body ? `${EVENT_LABEL[e.kind]}: ${e.body}` : EVENT_LABEL[e.kind];
}
