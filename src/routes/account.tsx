import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, FileUp, Loader2, LogOut, Paperclip, Trash2 } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth, saveDraftToAccount } from "@/hooks/use-auth";
import { labelFor, loadDraft, QUESTIONS, type Answers } from "@/lib/apply";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, card, PageShell } from "@/components/site/layout";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "My account — Lamp" }, { name: "robots", content: "noindex" }] }),
  component: Account,
});

type Application = {
  id: string;
  status: "new" | "reviewing" | "offers_ready" | "funded" | "closed";
  answers: Answers;
  first_name: string | null;
  business_name: string | null;
  created_at: string;
};

type Doc = { name: string; path: string };

const BUCKET = "documents";

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
        if (loadDraft()) await saveDraftToAccount(user.id, user.email);
        const { data, error: err } = await sb
          .from("applications")
          .select("id,status,answers,first_name,business_name,created_at")
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
        <div className="mx-auto max-w-xl px-5 py-24 text-center text-mist">
          Online accounts are being set up.{" "}
          <Link to="/apply" className="font-semibold text-aurora-a">
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
          <Loader2 className="size-6 animate-spin text-mist" />
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
            <p className="text-sm text-mist">{user.email}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Hi {name}.
            </h1>
          </div>
          <button
            type="button"
            className={cn(btnGhost, "px-4 py-2.5")}
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
            <p className="mt-2 text-mist">Answer a few quick questions to see your options.</p>
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.storage.from(BUCKET).list(userId, {
      sortBy: { column: "created_at", order: "desc" },
    });
    setDocs(
      (data ?? [])
        .filter((f) => f.name !== ".emptyFolderPlaceholder")
        .map((f) => ({ name: f.name.replace(/^\d+-/, ""), path: `${userId}/${f.name}` })),
    );
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = async (files: FileList | null) => {
    const sb = getSupabase();
    if (!sb || !files?.length) return;
    setUploading(true);
    setUploadError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is over 20 MB.`);
        const safe = file.name.replace(/[^\w.-]+/g, "_");
        const { error } = await sb.storage
          .from(BUCKET)
          .upload(`${userId}/${Date.now()}-${safe}`, file, { upsert: false });
        if (error) throw error;
      }
      await refresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (path: string) => {
    await getSupabase()?.storage.from(BUCKET).remove([path]);
    refresh();
  };

  const steps = [
    { label: "Answers received", done: true },
    { label: "Documents uploaded", done: docs.length > 0 },
    { label: "Shopping your file", done: app.status !== "new" },
    {
      label: "Offers ready",
      done: app.status === "offers_ready" || app.status === "funded",
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <section className={cn(card, "p-6")}>
          <h2 className="font-display text-lg font-semibold">Your file</h2>
          <ol className="mt-5 space-y-4">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ring-1",
                    s.done
                      ? "bg-aurora-a text-ink ring-aurora-a"
                      : i === current
                        ? "text-aurora-a ring-aurora-a"
                        : "text-mist ring-white/15",
                  )}
                >
                  {s.done ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn("text-sm", s.done || i === current ? "text-white" : "text-mist")}
                >
                  {s.label}
                </span>
                {i === current && (
                  <span className="ml-auto rounded-full bg-aurora-a/15 px-2.5 py-1 text-xs font-semibold text-aurora-a">
                    Next
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className={cn(card, "p-6")}>
          <h2 className="font-display text-lg font-semibold">Upload your documents</h2>
          <p className="mt-2 text-sm text-mist">
            Your last three months of business bank statements (PDF) and a photo of your driver's
            license. Files are private to you and the Lamp team.
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
            className="mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/15 px-6 py-8 text-sm text-mist transition hover:border-aurora-a/50 hover:bg-white/[0.03]"
          >
            {uploading ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <FileUp className="size-6 text-aurora-a" />
            )}
            <span className="font-semibold text-white">
              {uploading ? "Uploading…" : "Tap to choose files"}
            </span>
            PDF or photo, up to 20 MB each
          </button>
          {uploadError && <p className="mt-3 text-sm text-destructive">{uploadError}</p>}
          {docs.length > 0 && (
            <ul className="mt-5 space-y-2">
              {docs.map((d) => (
                <li
                  key={d.path}
                  className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm"
                >
                  <Paperclip className="size-4 shrink-0 text-mist" />
                  <span className="truncate">{d.name}</span>
                  <button
                    type="button"
                    onClick={() => remove(d.path)}
                    className="ml-auto text-mist transition hover:text-white"
                    aria-label={`Remove ${d.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={cn(card, "h-fit p-6")}>
        <h2 className="font-display text-lg font-semibold">
          {app.business_name || "Your answers"}
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          {QUESTIONS.map((q) => (
            <div key={q.key}>
              <dt className="text-xs text-mist/70">{q.title}</dt>
              <dd className="font-medium">{labelFor(q.key, app.answers[q.key]) ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs leading-relaxed text-mist/70">
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
