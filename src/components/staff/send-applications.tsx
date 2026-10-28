import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Mail, MessageSquare, Plus, Send, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/track";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/site";
import { tel } from "@/lib/engine-leads";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { chip, input, textarea } from "@/components/staff/field-styles";
import {
  applicationUrl,
  cleanEmail,
  EMAIL_RE,
  inviteEmail,
  inviteSms,
  MAX_NOTE,
  MAX_RECIPIENTS,
  type Channel,
  type Recipient,
  type SendRequest,
  type SendResult,
} from "@/lib/application-links";

/**
 * Send the full application: one personal link per person, picked from the lead list or typed
 * in. "Email it" has Lamp's server email the link from partners@ as "<Rep> at Lamp", so nobody
 * sees the link and replies go to the rep; "Copy link" hands the link back to text or send
 * yourself. Whoever signs from a link lands in that rep's files. The server checks everything
 * again (whose leads, do-not-contact, staff addresses), so the checks here are for convenience.
 */

/** One person to start the panel with: a lead from the list, or {} for an empty row. */
export type SendSeed = {
  lead_id?: number | null;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
};

type Row = {
  key: number;
  lead_id: number | null;
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone: string;
  channel: Channel;
  result: SendResult | null;
};

type Rep = { slug: string; name: string; admin_slug?: string | null };

let nextKey = 1;
const toRow = (s: SendSeed): Row => {
  const email = (s.email ?? "").trim();
  return {
    key: nextKey++,
    lead_id: s.lead_id ?? null,
    first_name: s.first_name ?? "",
    last_name: s.last_name ?? "",
    business_name: s.business_name ?? "",
    email,
    phone: s.phone ?? "",
    channel: email ? "email" : "link",
    result: null,
  };
};

const isDone = (r: Row) => r.result?.status === "sent" || r.result?.status === "link";
const isBlank = (r: Row) =>
  ![r.first_name, r.last_name, r.business_name, r.email, r.phone].some((v) => v.trim());

function problem(r: Row): string | null {
  const email = cleanEmail(r.email);
  if (email && !EMAIL_RE.test(email)) return "That email address doesn't look right.";
  if (r.channel === "email" && !email) return "Add an email address, or pick Copy link.";
  if (!r.first_name.trim() && !r.last_name.trim() && !r.business_name.trim())
    return "Add a name or a business, so you know who it's for.";
  return null;
}

/** POST /api/application-invites as the signed-in staff member. Throws with the server's words. */
async function postInvites(body: SendRequest): Promise<SendResult[]> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again to send.");
  const res = await fetch("/api/application-invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { results?: SendResult[]; error?: string };
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  void logActivity("send_application", { detail: `${(data.results ?? []).length} links` });
  return data.results ?? [];
}

const origin = () => (typeof window === "undefined" ? SITE.url : window.location.origin);

export function SendApplications({
  isAdmin,
  repSlug,
  reps,
  seed,
  onClose,
  onSent,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: Rep[];
  /** Leads picked on the list; empty starts with one blank row. */
  seed: SendSeed[];
  onClose: () => void;
  onSent?: (results: SendResult[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => (seed.length ? seed : [{}]).map(toRow));
  const [sendAs, setSendAs] = useState(repSlug ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);

  // Opened from a long lead list: bring the panel into view.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const sender = isAdmin ? sendAs : (repSlug ?? "");
  const senderRep = reps.find((r) => r.slug === sender);
  const senderName = senderRep?.name ?? "";
  // a rep on an admin's team sends in the admin's name (the server does the same)
  const facingName =
    (senderRep?.admin_slug && reps.find((r) => r.slug === senderRep.admin_slug)?.name) ||
    senderName;
  const pending = rows.filter((r) => !isDone(r) && !isBlank(r));
  const open = rows.filter((r) => !isDone(r));
  const over = pending.length > MAX_RECIPIENTS;
  // Everyone typed in has their link: the panel offers Done instead of Send.
  const allDone = rows.some(isDone) && !pending.length;

  const edit = (key: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, ...patch, result: isDone(r) ? r.result : null } : r)),
    );

  async function send() {
    if (!pending.length || over || !sender) return;
    if (pending.some((r) => problem(r))) {
      setTried(true);
      setError("Fix the rows marked below, or remove them.");
      return;
    }
    setBusy(true);
    setError("");
    const keys = pending.map((r) => r.key);
    const recipients: Recipient[] = pending.map((r) => ({
      lead_id: r.lead_id,
      first_name: r.first_name.trim(),
      last_name: r.last_name.trim(),
      business_name: r.business_name.trim(),
      email: cleanEmail(r.email),
      phone: r.phone.trim(),
      channel: r.channel,
    }));
    try {
      const results = await postInvites({
        action: "send",
        ...(isAdmin ? { rep_slug: sender } : {}),
        note: note.trim(),
        recipients,
      });
      // results carry the index into this request's recipients, not into the panel's rows
      const byKey = new Map<number, SendResult | null>();
      keys.forEach((k, i) => byKey.set(k, results.find((x) => x.index === i) ?? null));
      setRows((rs) =>
        rs.map((r) => (byKey.has(r.key) ? { ...r, result: byKey.get(r.key) ?? null } : r)),
      );
      setTried(false);
      if (results.some((x) => x.status === "sent" || x.status === "link")) onSent?.(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // What an emailed person reads, with the first person's name and a stand-in link.
  const sample = pending[0] ?? rows[0];
  const preview = inviteEmail({
    firstName: sample?.first_name ?? "",
    businessName: sample?.business_name ?? "",
    repName: facingName || "Your name",
    note,
    url: `${applicationUrl(origin(), sender || "you")}?i=…`,
    legalName: SITE.legalName,
    address: SITE.address,
  });

  return (
    <section ref={ref} className={cn(card, "mt-4 scroll-mt-24 p-5 sm:p-6")} data-send-applications>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">Send the application</h3>
          <p className="mt-1 text-sm text-smoke">
            Each person gets their own link to the full application. They fill it in, sign on the
            page, and the signed file comes straight back to{" "}
            {isAdmin ? (senderName ? `${senderName}'s` : "the rep's") : "your"} files.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="ml-auto shrink-0 rounded-full p-1.5 text-smoke ring-1 ring-line hover:text-ink"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      {isAdmin ? (
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-smoke">Send as</span>
          <select
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
            value={sendAs}
            // links already made carry this rep's name; the rest go out from the same rep
            disabled={busy || rows.some(isDone)}
            onChange={(e) => setSendAs(e.target.value)}
          >
            <option value="">Pick a rep</option>
            {reps.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
                {r.slug === repSlug ? " (you)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        !repSlug && (
          <p className="mt-4 text-sm text-destructive">
            Your account has no rep link yet, so links can't be sent as you. Ask an admin to link
            one.
          </p>
        )
      )}

      <p className="mt-4 text-xs text-smoke">
        <span className="font-semibold">Email it</span>: Lamp emails the link from{" "}
        partners@getlamp.app as "{facingName || "the rep"} at Lamp", and replies go to{" "}
        {facingName && facingName !== senderName
          ? `${facingName} and ${isAdmin ? senderName : "you"}`
          : isAdmin
            ? "the rep"
            : "you"}
        . <span className="font-semibold">Copy link</span>: you get the link to text or email
        yourself.
      </p>

      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.key}
            className="rounded-xl bg-sand p-3 sm:p-4"
            data-send-row={r.result?.status ?? "pending"}
          >
            {isDone(r) ? (
              <DoneRow row={r} repName={senderName} />
            ) : (
              <EditRow
                row={r}
                busy={busy}
                problem={tried && !isBlank(r) ? problem(r) : null}
                onEdit={(patch) => edit(r.key, patch)}
                onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              />
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={cn(chip, "mt-3")}
        disabled={busy || open.length >= MAX_RECIPIENTS}
        onClick={() => setRows((rs) => [...rs, toRow({})])}
      >
        <Plus className="size-3.5" /> Add someone who isn't on the list
      </button>

      <label className="mt-5 block text-sm">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
          Personal note (optional)
        </span>
        <textarea
          className={textarea}
          maxLength={MAX_NOTE}
          value={note}
          disabled={busy}
          placeholder="Great talking today. Here's the application we discussed."
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="mt-1 block text-right text-xs text-smoke">
          {note.length}/{MAX_NOTE}
        </span>
      </label>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-smoke hover:text-ink">
          What the email says
        </summary>
        <div className="mt-2 rounded-xl bg-sand p-4">
          <p className="text-xs text-smoke">Subject: {preview.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{preview.text}</p>
        </div>
      </details>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {over && (
        <p className="mt-4 text-sm text-destructive">
          At most {MAX_RECIPIENTS} at a time. Remove {pending.length - MAX_RECIPIENTS} and send the
          rest after.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!allDone && (
          <button
            type="button"
            className={cn(btnPrimary, "px-5 py-2.5")}
            disabled={busy || !pending.length || over || !sender}
            onClick={() => void send()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending.length
              ? `Send ${pending.length} application${pending.length === 1 ? "" : "s"}`
              : "Send"}
          </button>
        )}
        <button type="button" className={cn(btnOutline, "px-5 py-2.5")} onClick={onClose}>
          {allDone ? "Done" : "Cancel"}
        </button>
        {isAdmin && !sender && <span className="text-sm text-smoke">Pick who it's from.</span>}
      </div>
    </section>
  );
}

function EditRow({
  row: r,
  busy,
  problem: prob,
  onEdit,
  onRemove,
}: {
  row: Row;
  busy: boolean;
  problem: string | null;
  onEdit: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const field = (
    key: "first_name" | "last_name" | "business_name" | "email" | "phone",
    label: string,
  ) => (
    <input
      aria-label={label}
      placeholder={label}
      className={input}
      value={r[key]}
      disabled={busy}
      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
      inputMode={key === "email" ? "email" : key === "phone" ? "tel" : undefined}
      autoComplete="off"
      onChange={(e) => onEdit({ [key]: e.target.value })}
    />
  );
  const how = (c: Channel, label: string) => (
    <button
      type="button"
      aria-pressed={r.channel === c}
      disabled={busy}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold",
        r.channel === c ? "bg-ink text-white" : "text-smoke hover:text-ink",
      )}
      onClick={() => onEdit({ channel: c })}
    >
      {label}
    </button>
  );
  const failed = r.result && (r.result.status === "skipped" || r.result.status === "failed");
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1.4fr_1fr]">
        {field("first_name", "First name")}
        {field("last_name", "Last name")}
        {field("business_name", "Business")}
        {field("email", "Email")}
        {field("phone", "Phone")}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="How to send"
          className="inline-flex gap-0.5 rounded-full p-0.5 ring-1 ring-line"
        >
          {how("email", "Email it")}
          {how("link", "Copy link")}
        </div>
        {r.lead_id != null && <span className="text-xs text-smoke">From your lead list</span>}
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-smoke hover:text-ink"
          disabled={busy}
          onClick={onRemove}
        >
          <X className="size-3.5" /> Remove
        </button>
      </div>
      {prob && <p className="mt-2 text-xs text-destructive">{prob}</p>}
      {failed && (
        <p className="mt-2 text-xs text-destructive">
          {r.result!.status === "failed" ? "Didn't send" : "Skipped"}: {r.result!.detail}
        </p>
      )}
    </>
  );
}

function DoneRow({ row: r, repName }: { row: Row; repName: string }) {
  const name = `${r.first_name} ${r.last_name}`.trim();
  const who = [name, r.business_name.trim()].filter(Boolean).join(" · ");
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{who || "No name"}</span>
        <span className="text-smoke">
          {[cleanEmail(r.email), r.phone.trim()].filter(Boolean).join(" · ")}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-forest">
          <Check className="size-3.5" />
          {r.result!.status === "sent" ? r.result!.detail : "Link ready"}
        </span>
      </div>
      {r.result!.status === "link" && r.result!.url && (
        <LinkTools
          url={r.result!.url}
          firstName={r.first_name}
          businessName={r.business_name}
          email={cleanEmail(r.email)}
          phone={r.phone}
          repName={repName}
        />
      )}
    </>
  );
}

/** Copy a personal link, or open it in a text or the rep's own email, with Lamp's words. */
export function LinkTools({
  url,
  firstName,
  businessName,
  email,
  phone,
  repName,
}: {
  url: string;
  firstName: string;
  businessName: string;
  email: string;
  phone: string;
  repName: string;
}) {
  const text = inviteSms(firstName, repName || "your rep", url);
  const subject = inviteEmail({
    firstName,
    businessName,
    repName,
    note: "",
    url,
    legalName: SITE.legalName,
    address: SITE.address,
  }).subject;
  const to = encodeURIComponent(email).replace(/%40/g, "@");
  return (
    <div className="mt-2 space-y-2" data-link-tools>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          aria-label="Personal application link"
          className={cn(input, "min-w-0 flex-1 font-mono text-xs")}
          value={url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <CopyButton text={url} />
      </div>
      <div className="flex flex-wrap gap-2">
        {tel(phone) && (
          <a className={chip} href={`sms:${tel(phone)}?&body=${encodeURIComponent(text)}`}>
            <MessageSquare className="size-3.5" /> Text it
          </a>
        )}
        <a
          className={chip}
          href={`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}
        >
          <Mail className="size-3.5" /> Open in my email
        </a>
      </div>
    </div>
  );
}

/** Copies to the clipboard; where the browser refuses, says to copy it by hand. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  useEffect(() => {
    if (!state) return;
    const t = window.setTimeout(() => setState(""), 2000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={chip}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select it and copy" : label}
    </button>
  );
}
