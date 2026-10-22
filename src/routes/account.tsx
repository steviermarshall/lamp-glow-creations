import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, FileUp, Loader2, LogOut, Paperclip, Trash2 } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth, saveDraftToAccount } from "@/hooks/use-auth";
import { labelFor, loadDraft, QUESTIONS, type Answers, type Draft } from "@/lib/apply";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/site";
import type { Database } from "@/integrations/supabase/types";
import { btnOutline, btnPrimary, card, PageShell } from "@/components/site/layout";
import { MyOffers } from "@/components/site/my-offers";

export const Route = createFileRoute("/account")({
  head: () =>
    seo({
      path: "/account",
      title: "My account — Lamp",
      description: "Check on your Lamp file and your offers.",
      noindex: true,
    }),
  component: Account,
});

type Stage = Database["public"]["Enums"]["application_stage"];
type DocStatus = Database["public"]["Enums"]["document_status"];

type Application = {
  id: string;
  status: Stage;
  answers: Answers;
  first_name: string | null;
  business_name: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

type Doc = {
  name: string;
  path: string;
  /** null: a file in the folder with no documents row, so the team can't see it. */
  status: DocStatus | null;
  createdAt: string | null;
  removable: boolean;
};

const BUCKET = "documents";
const MAX_BYTES = 20 * 1024 * 1024;

/** From here on the file has gone to funders: its documents count as in, and stay. */
const SENT: readonly Stage[] = ["submitted", "offers_ready", "accepted", "closing", "funded"];
const OFFERS: readonly Stage[] = ["offers_ready", "accepted", "closing", "funded"];
const ENDED: readonly Stage[] = ["declined", "withdrawn", "closed"];

/** One line under "Your file" where the steps alone don't say enough. */
const STAGE_NOTE: Partial<Record<Stage, string>> = {
  docs_needed:
    "We need a document from you. Upload it below, or email hello@getlamp.app if you're not sure which one.",
  submitted: "Your file is with funders now.",
  offers_ready: "You have offers. Your Lamp rep will go through them with you.",
  accepted: "You picked an offer. The funder is preparing the paperwork.",
  closing: "The funder is finishing their closing steps.",
  funded: "Funded. Thank you for working with Lamp.",
  declined: "This file didn't go ahead. You can check your options again any time.",
  withdrawn: "You withdrew this file. You can check your options again any time.",
  closed: "This file is closed. You can check your options again any time.",
};
const DOCS_ARRIVED_NOTE = "Thanks, we have your new document. The team will review it.";

const isFinished = (d: Draft | null) =>
  !!d &&
  QUESTIONS.every((q) => d.answers[q.key]) &&
  !!d.answers.firstName &&
  !!d.answers.businessName;

const fileLabel = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/^\d+-/, "");
const after = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(a) > Date.parse(b);

/**
 * A merchant may remove an unaccepted file until its application first goes to funders;
 * after that it stays with the deal. Mirrors the database rule. Files with no row (the
 * team never saw them) can always go.
 */
const canRemoveRow = (status: DocStatus | null, appSubmittedAt: string | null | undefined) =>
  status === null || ((status === "received" || status === "rejected") && !appSubmittedAt);

function Account() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [app, setApp] = useState<Application | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user) return;
    (async () => {
      try {
        // Only a finished draft becomes an application. A half-answered one (say, from
        // tapping "Check my options" while signed in) waits in /apply instead.
        if (isFinished(loadDraft())) await saveDraftToAccount(user.id, user.email);
        const { data, error: err } = await sb
          .from("applications")
          .select("id,status,answers,first_name,business_name,created_at,updated_at,submitted_at")
          // The policy already limits rows to this user; the explicit filter lets Postgres
          // use the (user_id, created_at) index instead of scanning the table.
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (err) throw err;
        setApp(data as Application | null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load your account.");
      } finally {
        setFetching(false);
      }
    })();
  }, [user]);

  if (!isSupabaseConfigured) {
    return (
      <PageShell>
        <div className="mx-auto max-w-xl px-5 py-24 text-center text-smoke">
          Online accounts are being set up.{" "}
          <Link to="/apply" className="font-semibold text-amber-deep">
            Check your options
          </Link>{" "}
          in the meantime.
        </div>
      </PageShell>
    );
  }

  if (loading || !user || fetching) {
    return (
      <PageShell footer={false}>
        <div className="grid place-items-center py-40">
          <Loader2 className="size-6 animate-spin text-smoke" />
        </div>
      </PageShell>
    );
  }

  const name =
    app?.first_name ||
    (user.user_metadata?.["first_name"] as string | undefined) ||
    (user.user_metadata?.["full_name"] as string | undefined)?.split(" ")[0] ||
    "there";

  return (
    <PageShell>
      <div className="mx-auto max-w-4xl px-5 pb-24 pt-10 sm:px-6 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-smoke">{user.email}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Hi {name}.
            </h1>
          </div>
          <button
            type="button"
            className={cn(btnOutline, "px-4 py-2.5")}
            onClick={async () => {
              await getSupabase()?.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>

        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

        {!app ? (
          <div className={cn(card, "mt-8 p-8 text-center")}>
            <h2 className="font-display text-xl font-semibold">Let's get your file started</h2>
            <p className="mt-2 text-smoke">Answer a few quick questions to see your options.</p>
            <Link to="/apply" className={cn(btnPrimary, "mt-6")}>
              Check my options
            </Link>
          </div>
        ) : (
          <Dashboard app={app} userId={user.id} />
        )}
      </div>
    </PageShell>
  );
}

function Dashboard({ app, userId }: { app: Application; userId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [earlier, setEarlier] = useState<Doc[]>([]);
  const [askedAt, setAskedAt] = useState<string | null>(null);
  const [listOk, setListOk] = useState(false);
  const [listError, setListError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshSeq = useRef(0);

  // This application's indexed files; files indexed on the merchant's earlier applications;
  // and files in the folder that no row points at (the team can't see those).
  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const seq = ++refreshSeq.current;
    const [files, rows, apps, asked] = await Promise.all([
      sb.storage
        .from(BUCKET)
        .list(userId, { limit: 1000, sortBy: { column: "created_at", order: "desc" } }),
      sb
        .from("documents")
        .select("storage_path,status,original_name,application_id,created_at")
        .eq("user_id", userId)
        .eq("bucket", BUCKET)
        .order("created_at", { ascending: false }),
      sb.from("applications").select("id,submitted_at").eq("user_id", userId),
      // When the team last asked for documents on this file, from its timeline.
      sb
        .from("events")
        .select("occurred_at")
        .eq("application_id", app.id)
        .eq("kind", "stage_change")
        .eq("to_stage", "docs_needed")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (seq !== refreshSeq.current) return; // a newer refresh is on its way
    if (files.error || rows.error || apps.error) {
      // Keep what was on screen, but with no remove buttons: a file whose row failed to
      // load would otherwise look unindexed.
      setListOk(false);
      setListError("We couldn't load your files just now. Refresh the page to try again.");
      return;
    }
    const submittedAt = new Map(apps.data.map((a) => [a.id, a.submitted_at]));
    const indexed = new Set(rows.data.map((r) => r.storage_path));
    const toDoc = (r: (typeof rows.data)[number]): Doc => ({
      name: r.original_name || fileLabel(r.storage_path),
      path: r.storage_path,
      status: r.status,
      createdAt: r.created_at,
      removable: canRemoveRow(r.status, submittedAt.get(r.application_id)),
    });
    const unsent: Doc[] = files.data
      .filter((f) => f.name !== ".emptyFolderPlaceholder" && !indexed.has(`${userId}/${f.name}`))
      .map((f) => ({
        name: fileLabel(f.name),
        path: `${userId}/${f.name}`,
        status: null,
        createdAt: f.created_at ?? null,
        removable: true,
      }));
    setDocs([...rows.data.filter((r) => r.application_id === app.id).map(toDoc), ...unsent]);
    setEarlier(rows.data.filter((r) => r.application_id !== app.id).map(toDoc));
    if (!asked.error) setAskedAt(asked.data?.occurred_at ?? null);
    setListOk(true);
    setListError("");
  }, [userId, app.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Upload one file and index it: "saved", "failed" (nothing left behind), or "unknown" when
   * the result could not be confirmed (the list after the upload shows the truth).
   */
  const uploadOne = async (file: File): Promise<"saved" | "failed" | "unknown"> => {
    const sb = getSupabase();
    if (!sb) return "failed";
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) return "failed";
    const { error: indexError } = await sb.from("documents").insert({
      application_id: app.id,
      user_id: userId,
      bucket: BUCKET,
      storage_path: path,
      original_name: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
    });
    if (!indexError) return "saved";
    // The row may have been written even though the reply was lost: then it worked.
    const { data: row, error: checkError } = await sb
      .from("documents")
      .select("id")
      .eq("bucket", BUCKET)
      .eq("storage_path", path)
      .maybeSingle();
    if (checkError) return "unknown";
    if (row) return "saved";
    // No row points at the file, so the database lets it go.
    await sb.storage.from(BUCKET).remove([path]);
    return "failed";
  };

  const upload = async (list: FileList | null) => {
    if (!getSupabase() || !list?.length) return;
    const files = Array.from(list);
    setUploadError("");
    const tooBig = files.filter((f) => f.size > MAX_BYTES).map((f) => f.name);
    if (tooBig.length) {
      setUploadError(
        `${tooBig.join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 20 MB. Nothing was uploaded.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true);
    const failed: string[] = [];
    const unsure: string[] = [];
    try {
      for (const file of files) {
        const outcome = await uploadOne(file);
        if (outcome === "failed") failed.push(file.name);
        if (outcome === "unknown") unsure.push(file.name);
      }
    } finally {
      await refresh();
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
    const messages: string[] = [];
    if (failed.length) {
      const saved = files.length - failed.length - unsure.length;
      messages.push(
        `${failed.join(", ")} couldn't be saved. Please try again.` +
          (saved ? ` The other ${saved === 1 ? "file was" : `${saved} files were`} saved.` : ""),
      );
    }
    if (unsure.length) {
      messages.push(
        `We couldn't confirm ${unsure.join(", ")}. If it isn't in the list below, please try again.`,
      );
    }
    if (messages.length) setUploadError(messages.join(" "));
  };

  const remove = async (doc: Doc) => {
    const sb = getSupabase();
    if (!sb || removing.has(doc.path)) return;
    setRemoving((s) => new Set(s).add(doc.path));
    setUploadError("");
    const fail = () => setUploadError(`${doc.name} couldn't be removed. Please try again.`);
    try {
      // The row goes first; the database lets the file go only once no row points at it.
      const del = await sb
        .from("documents")
        .delete()
        .eq("bucket", BUCKET)
        .eq("storage_path", doc.path)
        .select("id");
      if (del.error) return fail();
      if (!del.data.length) {
        const still = await sb
          .from("documents")
          .select("id")
          .eq("bucket", BUCKET)
          .eq("storage_path", doc.path)
          .maybeSingle();
        if (still.error) return fail();
        if (still.data) {
          setUploadError(`${doc.name} is with the team now, so it stays on your file.`);
          return;
        }
      }
      const rm = await sb.storage.from(BUCKET).remove([doc.path]);
      if (rm.error) return fail();
    } finally {
      await refresh();
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(doc.path);
        return next;
      });
    }
  };

  const ended = ENDED.includes(app.status);
  const sent = SENT.includes(app.status);
  const canUpload = !ended && app.status !== "funded";
  const showRemove = (d: Doc) => listOk && !uploading && !removing.has(d.path) && d.removable;

  const onFile = docs.filter((d) => d.status === "received" || d.status === "accepted");
  const arrivedSinceAsked =
    app.status === "docs_needed" &&
    onFile.some((d) => after(d.createdAt, askedAt ?? app.updated_at));
  const note = arrivedSinceAsked
    ? DOCS_ARRIVED_NOTE
    : app.status === "declined" && app.submitted_at
      ? "No funder made an offer on this file. You can check your options again any time."
      : STAGE_NOTE[app.status];
  const steps = [
    { label: "Answers received", done: true },
    {
      label: "Documents uploaded",
      done: sent || (app.status === "docs_needed" ? arrivedSinceAsked : onFile.length > 0),
    },
    { label: "Shopping your file", done: sent },
    { label: "Offers ready", done: OFFERS.includes(app.status) },
    { label: "Funded", done: app.status === "funded" },
  ];
  const current = steps.findIndex((s) => !s.done);
  const kept = [...docs, ...earlier].some((d) => !d.removable);

  const docItem = (d: Doc) => {
    const tag =
      d.status === "accepted"
        ? "Accepted"
        : d.status === "rejected"
          ? "Not accepted"
          : d.status === null
            ? "Not sent to the team"
            : null;
    return (
      <li key={d.path} className="flex items-center gap-3 rounded-xl bg-sand px-4 py-3 text-sm">
        <Paperclip className="size-4 shrink-0 text-smoke" />
        <span className="truncate">{d.name}</span>
        {tag && (
          <span className="ml-auto shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-smoke ring-1 ring-line">
            {tag}
          </span>
        )}
        {showRemove(d) && (
          <button
            type="button"
            onClick={() => remove(d)}
            className={cn("text-smoke transition hover:text-ink", !tag && "ml-auto")}
            aria-label={`Remove ${d.name}`}
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <section className={cn(card, "p-6")}>
          <h2 className="font-display text-lg font-semibold">Your file</h2>
          {note && <p className="mt-2 text-sm leading-relaxed text-smoke">{note}</p>}
          {ended ? (
            <Link to="/apply" className={cn(btnPrimary, "mt-5")}>
              Check my options
            </Link>
          ) : (
            <ol className="mt-5 space-y-4">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ring-1",
                      s.done
                        ? "bg-amber text-ink ring-amber"
                        : i === current
                          ? "text-amber-deep ring-amber"
                          : "text-smoke ring-line",
                    )}
                  >
                    {s.done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <span
                    className={cn("text-sm", s.done || i === current ? "text-ink" : "text-smoke")}
                  >
                    {s.label}
                  </span>
                  {i === current && (
                    <span className="ml-auto rounded-full bg-amber/15 px-2.5 py-1 text-xs font-semibold text-amber-deep">
                      Next
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <MyOffers applicationId={app.id} />

        {(canUpload || docs.length > 0 || earlier.length > 0 || listError) && (
          <section className={cn(card, "p-6")}>
            <h2 className="font-display text-lg font-semibold">
              {canUpload ? "Upload your documents" : "Your documents"}
            </h2>
            {canUpload && (
              <>
                <p className="mt-2 text-sm text-smoke">
                  {app.submitted_at
                    ? "Need to send something else? Add it here. Files sent after your file goes to funders stay on your file."
                    : "Your last three months of business bank statements (PDF) and a photo of your driver's license. Files are private to you and the Lamp team."}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => upload(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-8 text-sm text-smoke transition hover:border-amber hover:bg-sand"
                >
                  {uploading ? (
                    <Loader2 className="size-6 animate-spin" />
                  ) : (
                    <FileUp className="size-6 text-amber-deep" />
                  )}
                  <span className="font-semibold text-ink">
                    {uploading ? "Uploading…" : "Tap to choose files"}
                  </span>
                  PDF or photo, up to 20 MB each
                </button>
              </>
            )}
            {uploadError && <p className="mt-3 text-sm text-destructive">{uploadError}</p>}
            {listError && <p className="mt-3 text-sm text-destructive">{listError}</p>}
            {docs.length > 0 && <ul className="mt-5 space-y-2">{docs.map(docItem)}</ul>}
            {earlier.length > 0 && (
              <>
                <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-smoke">
                  From an earlier application
                </h3>
                <ul className="mt-2 space-y-2">{earlier.map(docItem)}</ul>
              </>
            )}
            {kept && (
              <p className="mt-4 text-xs leading-relaxed text-smoke">
                Files sent with your application stay on it. To have one removed, email{" "}
                <a className="underline" href="mailto:hello@getlamp.app">
                  hello@getlamp.app
                </a>
                .
              </p>
            )}
          </section>
        )}
      </div>

      <section className={cn(card, "h-fit p-6")}>
        <h2 className="font-display text-lg font-semibold">
          {app.business_name || "Your answers"}
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          {QUESTIONS.map((q) => (
            <div key={q.key}>
              <dt className="text-xs text-smoke">{q.title}</dt>
              <dd className="font-medium">{labelFor(q.key, app.answers[q.key]) ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs leading-relaxed text-smoke">
          Need to change something? Email{" "}
          <a className="underline" href="mailto:hello@getlamp.app">
            hello@getlamp.app
          </a>
          .
        </p>
      </section>
    </div>
  );
}
