import { useCallback, useEffect, useState } from "react";
import { Copy, FilePlus2, Link2, Loader2, Mail, MessageSquare, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { btnOutline, btnPrimary } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";
import { DOC_ITEMS, type DocItemKey } from "@/lib/document-requests";

/**
 * Request documents on a file (migration 20261030090000_document_requests.sql): tick what's needed,
 * get a link to copy into a text or email, and see each request with what came in for it. The
 * merchant's page is /upload/<link>; Lamp's server makes and checks the links
 * (document-requests.server.ts). Until the SQL runs this shows nothing.
 */

export type RequestLabel = { title: string; at: string; by: string | null };

type Req = {
  id: string;
  title: string;
  items: { key: DocItemKey; label: string }[];
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
};

const TITLES = ["Closing documents", "Underwriting", "More statements"];

async function call(body: unknown) {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch("/api/documents/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

export function DocRequests({
  fileId,
  firstName,
  phone,
  email,
  docsTick,
  onLabels,
}: {
  fileId: string;
  firstName: string | null;
  phone: string | null;
  email: string | null;
  /** bumps when the file's documents reload, so counts stay right */
  docsTick: number;
  /** document id → the request it answered, for the documents list */
  onLabels: (m: Map<string, RequestLabel>) => void;
}) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string>("Closing documents");
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ url: string; title: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [r, d] = await Promise.all([
      sb
        .from("document_requests" as never)
        .select("id,title,items,note,created_by_name,created_at,expires_at,closed_at")
        .eq("application_id", fileId)
        .order("created_at", { ascending: false }),
      sb
        .from("documents")
        .select("id,request_id" as never)
        .eq("application_id", fileId)
        .not("request_id" as never, "is", null),
    ]);
    if (r.error) {
      setReqs(null); // the SQL hasn't run yet: show nothing
      return;
    }
    const list = r.data as unknown as Req[];
    setReqs(list);
    const byId = new Map(list.map((x) => [x.id, x]));
    const labels = new Map<string, RequestLabel>();
    const c: Record<string, number> = {};
    for (const doc of (d.data ?? []) as unknown as { id: string; request_id: string }[]) {
      const q = byId.get(doc.request_id);
      c[doc.request_id] = (c[doc.request_id] ?? 0) + 1;
      if (q) labels.set(doc.id, { title: q.title, at: q.created_at, by: q.created_by_name });
    }
    setCounts(c);
    onLabels(labels);
  }, [fileId, onLabels]);

  useEffect(() => {
    void load();
  }, [load, docsTick]);

  async function make() {
    const items = (Object.keys(picked) as DocItemKey[])
      .filter((k) => picked[k] !== null)
      .map((k) => ({ key: k, label: (picked[k] || "").trim() || DOC_ITEMS[k].label }));
    if (!items.length) {
      setError("Tick at least one document.");
      return;
    }
    setBusy("make");
    setError("");
    try {
      const j = await call({ application_id: fileId, title, items, note });
      setLink({ url: j.url!, title });
      setOpen(false);
      setPicked({});
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the link.");
    } finally {
      setBusy(null);
    }
  }

  async function replace(q: Req) {
    setBusy(`new:${q.id}`);
    setError("");
    try {
      const j = await call({ replace_id: q.id });
      setLink({ url: j.url!, title: q.title });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a new link.");
    } finally {
      setBusy(null);
    }
  }

  async function close(q: Req) {
    if (!confirm("Close this link? The merchant won't be able to add more files through it."))
      return;
    setBusy(`close:${q.id}`);
    try {
      await call({ close_id: q.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close it.");
    } finally {
      setBusy(null);
    }
  }

  if (reqs === null) return null;

  const message = link
    ? `Hi${firstName ? ` ${firstName}` : ""}, it's Lamp. Please send your ${link.title.toLowerCase()} here (no sign-in needed): ${link.url}`
    : "";

  return (
    <div className="mt-3" data-doc-requests>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(btnOutline, "px-4 py-2 text-sm")}
          onClick={() => {
            setOpen((o) => !o);
            setError("");
          }}
          aria-expanded={open}
        >
          <FilePlus2 className="size-4" /> Request documents
        </button>
        <span className="text-xs text-smoke">
          A link they drop files into, no sign-in. Copy it into a text or email.
        </span>
      </div>

      {open && (
        <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-line" data-doc-request-form>
          <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
            What it&apos;s for
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TITLES.map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs ring-1",
                  title === t ? "bg-ink text-white ring-ink" : "ring-line",
                )}
                onClick={() => setTitle(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-smoke">
            What they need to send
          </p>
          <ul className="mt-2 space-y-2">
            {(Object.keys(DOC_ITEMS) as DocItemKey[]).map((k) => {
              const on = picked[k] !== undefined && picked[k] !== null;
              const needsText = k === "statements" || k === "other";
              return (
                <li key={k} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={on}
                      onChange={(e) =>
                        setPicked((p) => ({ ...p, [k]: e.target.checked ? "" : null }))
                      }
                    />
                    {DOC_ITEMS[k].label}
                  </label>
                  {on && needsText && (
                    <input
                      className={cn(input, "w-auto min-w-[16rem] flex-1 py-1.5 text-sm")}
                      placeholder={
                        k === "statements"
                          ? "Which months? e.g. Bank statements: August and September"
                          : "What exactly? e.g. Landlord letter"
                      }
                      value={picked[k] ?? ""}
                      onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.value }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <label className="mt-4 block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-smoke">
              Message on their page (optional)
            </span>
            <textarea
              className={cn(input, "mt-1 min-h-16")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. We're almost there: the funder needs these to close."
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className={cn(btnPrimary, "px-4 py-2 text-sm")}
              disabled={busy === "make"}
              onClick={() => void make()}
            >
              {busy === "make" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Make the link
            </button>
            <button type="button" className="text-sm text-smoke" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {link && (
        <div className="mt-3 rounded-xl bg-leaf/10 p-4 ring-1 ring-leaf/40" data-doc-link>
          <p className="text-sm font-semibold">Link ready: {link.title}</p>
          <p className="mt-0.5 text-xs text-smoke">
            Copy it now. For security it isn&apos;t shown again; if it&apos;s lost, make a new link
            below.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              className={cn(input, "min-w-[16rem] flex-1 py-1.5 text-xs")}
              value={link.url}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={cn(btnOutline, "px-3 py-1.5 text-xs")}
              onClick={() => {
                void navigator.clipboard.writeText(link.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              <Copy className="size-3.5" /> {copied ? "Copied" : "Copy link"}
            </button>
            {phone && (
              <a
                className={cn(btnOutline, "px-3 py-1.5 text-xs")}
                href={`sms:${phone.replace(/[^0-9+]/g, "")}?&body=${encodeURIComponent(message)}`}
              >
                <MessageSquare className="size-3.5" /> Text it
              </a>
            )}
            {email && (
              <a
                className={cn(btnOutline, "px-3 py-1.5 text-xs")}
                href={`mailto:${email}?subject=${encodeURIComponent(`Lamp: ${link.title}`)}&body=${encodeURIComponent(message)}`}
              >
                <Mail className="size-3.5" /> Email it
              </a>
            )}
            <button
              type="button"
              className="ml-auto text-smoke"
              aria-label="Hide the link"
              onClick={() => setLink(null)}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {reqs.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Document requests">
          {reqs.map((q) => {
            const expired = Date.parse(q.expires_at) < Date.now();
            const state = q.closed_at ? "closed" : expired ? "expired" : "open";
            return (
              <li
                key={q.id}
                data-doc-request={q.id}
                className="rounded-xl px-4 py-3 text-sm ring-1 ring-line"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <b>{q.title}</b>
                  <span className="text-xs text-smoke">
                    asked {age(q.created_at)} ago
                    {q.created_by_name ? ` by ${q.created_by_name}` : ""}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      state === "open" ? "bg-leaf/20 text-forest" : "bg-sand text-smoke",
                    )}
                  >
                    {state === "open"
                      ? `link open until ${new Date(q.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : state}
                  </span>
                  <span className="text-xs text-smoke">
                    · {counts[q.id] ?? 0} file{(counts[q.id] ?? 0) === 1 ? "" : "s"} in
                  </span>
                </div>
                <p className="mt-1 text-xs text-smoke">{q.items.map((i) => i.label).join(" · ")}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    className="font-semibold text-forest hover:underline"
                    disabled={!!busy}
                    onClick={() => void replace(q)}
                  >
                    {busy === `new:${q.id}` ? "Making…" : "New link"}
                  </button>
                  {state === "open" && (
                    <button
                      type="button"
                      className="text-smoke hover:underline"
                      disabled={!!busy}
                      onClick={() => void close(q)}
                    >
                      Close link
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
