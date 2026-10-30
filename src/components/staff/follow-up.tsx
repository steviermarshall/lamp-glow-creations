import { useCallback, useEffect, useState } from "react";
import { Check, Copy, FileUp, Loader2, Mail, MessageSquare, Phone, Sparkles } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnOutline } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";

/**
 * Follow-up drafts (Lamp Brain, slice 2): a text, an email and call notes for one Today item, from
 * /api/brain/draft (drafts.server.ts). The rep edits it and sends it from their own phone or mail
 * app; Lamp sends nothing. Mark sent / Mark called puts a line on the file's timeline. Texts only
 * show when the merchant's consent to texts is on record.
 */

type Draft = { text: string; email_subject: string; email_body: string; call: string[] };
type Answer = {
  label: string;
  business: string;
  draft: Draft;
  written: string[];
  reason: "off" | "limit" | "cap" | "failed" | null;
  wants_docs_link: boolean;
  to: { first_name: string | null; email: string | null; phone: string | null; text: boolean };
};
type Tab = "text" | "email" | "call";

async function token() {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  return session.access_token;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

const tabBtn = (on: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
    on ? "bg-ink text-white" : "text-smoke ring-1 ring-line hover:text-ink",
  );

export function FollowUp({ kind, id }: { kind: "file" | "link"; id: string }) {
  const [a, setA] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(
    async (docsLink?: string) => {
      setError("");
      try {
        const r = await post<Answer>("/api/brain/draft", {
          kind,
          id,
          ...(docsLink ? { docs_link: docsLink } : {}),
        });
        setA(r);
        setText(r.draft.text);
        setSubject(r.draft.email_subject);
        setBody(r.draft.email_body);
        setTab((t) => (t === "text" && !r.to.text ? (r.to.email ? "email" : "call") : t));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't make a draft.");
      }
    },
    [kind, id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy. Select the text and copy it yourself.");
    }
  }

  async function docsLink() {
    setBusy("docs");
    setError("");
    try {
      const r = await post<{ url: string }>("/api/documents/request", {
        application_id: id,
        title: "Bank statements",
        items: [{ key: "statements", label: "Business bank statements: last 3 months" }],
      });
      await load(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the documents link.");
    } finally {
      setBusy(null);
    }
  }

  async function sent(channel: Tab) {
    setBusy(`sent:${channel}`);
    setError("");
    try {
      await post("/api/brain/draft", { kind, id, sent: channel });
      setDone(
        channel === "call" ? "Logged the call on the file." : `Logged the ${channel} on the file.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log it.");
    } finally {
      setBusy(null);
    }
  }

  if (!a)
    return (
      <div className="mt-2 rounded-xl bg-white px-3 py-3 text-sm ring-1 ring-line" data-follow-up>
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <span className="inline-flex items-center gap-2 text-smoke">
            <Loader2 className="size-4 animate-spin" /> Writing a draft…
          </span>
        )}
      </div>
    );

  const by = (field: string) =>
    a.written.includes(field) ? (
      <Sparkles className="size-3.5 text-forest" aria-label="Written by Claude" />
    ) : null;
  const logBtn = (channel: Tab, label: string) =>
    kind === "file" && (
      <button
        type="button"
        className={cn(btnOutline, "px-3 py-1.5 text-xs")}
        disabled={!!busy}
        onClick={() => void sent(channel)}
      >
        {busy === `sent:${channel}` ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        {label}
      </button>
    );

  return (
    <div className="mt-2 rounded-xl bg-white p-3 text-sm ring-1 ring-line" data-follow-up>
      <div className="flex flex-wrap items-center gap-2">
        {a.to.text && (
          <button type="button" className={tabBtn(tab === "text")} onClick={() => setTab("text")}>
            <MessageSquare className="size-3.5" /> Text
          </button>
        )}
        <button type="button" className={tabBtn(tab === "email")} onClick={() => setTab("email")}>
          <Mail className="size-3.5" /> Email
        </button>
        <button type="button" className={tabBtn(tab === "call")} onClick={() => setTab("call")}>
          <Phone className="size-3.5" /> Call notes
        </button>
        {!a.to.text && (
          <span className="text-xs text-smoke">
            No text: {a.to.phone ? "no consent to texts on record" : "no mobile number"}.
          </span>
        )}
      </div>

      {a.wants_docs_link && (
        <button
          type="button"
          className={cn(btnOutline, "mt-3 px-3 py-1.5 text-xs")}
          disabled={!!busy}
          onClick={() => void docsLink()}
          data-docs-link
        >
          {busy === "docs" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileUp className="size-3.5" />
          )}
          Add a documents link for statements
        </button>
      )}

      {tab === "text" && a.to.text && (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-1.5 text-xs text-smoke">
            Text to {a.to.first_name || "the merchant"} {by("text")}
            <span className="ml-auto">{text.length} characters</span>
          </label>
          <textarea
            className={cn(input, "min-h-24 rounded-2xl")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnOutline, "px-3 py-1.5 text-xs")}
              onClick={() => void copy("text", text)}
            >
              <Copy className="size-3.5" /> {copied === "text" ? "Copied" : "Copy"}
            </button>
            {a.to.phone && (
              <a
                className={cn(btnOutline, "px-3 py-1.5 text-xs")}
                href={`sms:${a.to.phone}?&body=${encodeURIComponent(text)}`}
              >
                <MessageSquare className="size-3.5" /> Open in Messages
              </a>
            )}
            {logBtn("text", "Mark sent")}
          </div>
        </div>
      )}

      {tab === "email" && (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-1.5 text-xs text-smoke">
            Subject {by("email_subject")}
          </label>
          <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-smoke">
            Email to {a.to.email || "the merchant"} {by("email_body")}
          </label>
          <textarea
            className={cn(input, "min-h-36 rounded-2xl")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnOutline, "px-3 py-1.5 text-xs")}
              onClick={() => void copy("email", `${subject}\n\n${body}`)}
            >
              <Copy className="size-3.5" /> {copied === "email" ? "Copied" : "Copy"}
            </button>
            {a.to.email && (
              <a
                className={cn(btnOutline, "px-3 py-1.5 text-xs")}
                href={`mailto:${encodeURIComponent(a.to.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              >
                <Mail className="size-3.5" /> Open in email
              </a>
            )}
            {logBtn("email", "Mark sent")}
          </div>
        </div>
      )}

      {tab === "call" && (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-smoke">For your call {by("call")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {a.draft.call.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {a.to.phone && (
              <a className={cn(btnOutline, "px-3 py-1.5 text-xs")} href={`tel:${a.to.phone}`}>
                <Phone className="size-3.5" /> Call {a.to.first_name || ""}
              </a>
            )}
            {logBtn("call", "Mark called")}
          </div>
        </div>
      )}

      {kind === "link" && (
        <p className="mt-2 text-xs text-smoke">
          This is a link, not a file yet: send it again from Applications if they lost it.
        </p>
      )}
      {done && <p className="mt-2 text-xs font-semibold text-forest">{done}</p>}
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
