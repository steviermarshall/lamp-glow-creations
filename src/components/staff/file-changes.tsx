import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, RotateCcw, Send, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { detailsToPdf, fromRow, type Details } from "@/lib/application-details";
import { downloadApplicationPdf } from "@/lib/application-pdf";
import { diffDetails, matchItems, type Change } from "@/lib/application-diff";
import {
  changeSuggestions,
  defaultAsk,
  MAX_ITEMS,
  MAX_MESSAGE,
  sensitiveText,
  type ChangeItem,
  type ChangeSection,
  type SendBackRequest,
  type SendBackResult,
  type StaffChangeRequest,
  type StaffVersion,
  type StaffVersions,
} from "@/lib/application-changes";
import { revealVersion, type FullApplication } from "@/lib/full-application";
import { logActivity } from "@/lib/track";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { chip, input, textarea } from "@/components/staff/field-styles";

/**
 * Send back for changes, and the versions a merchant signed. An admin or the file's rep ticks
 * what's missing; Lamp emails the merchant (an update link, or a note to sign in to their
 * account); they update the application and sign again. The signed version they replace is kept
 * with its PDF, and this card shows what changed: what was asked for and got updated, what
 * wasn't, and anything else that changed (who the application is about, in red). Nothing goes to
 * funders while a request is open, and an update goes out after Mark reviewed.
 */

const CLOSED_STAGES = new Set(["funded", "withdrawn", "closed"]);
const SECTION_LABEL: Record<ChangeSection, string> = {
  business: "Business",
  owners: "Owners",
  property: "Real estate",
  funding: "Funding",
  other: "Other",
};

async function postStaff(body: SendBackRequest): Promise<SendBackResult> {
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
  const data = (await res.json().catch(() => ({}))) as Partial<SendBackResult> & { error?: string };
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data as SendBackResult;
}

const versionDetails = (v: StaffVersion): Details => fromRow(v);

export function FileChanges({
  fileId,
  full,
  versions,
  stage,
  claimed,
  sendTo,
  repName,
  canAct,
  onChanged,
}: {
  fileId: string;
  full: FullApplication | null;
  versions: StaffVersions | null;
  stage: string;
  /** The merchant has a Lamp account: they update from it rather than from a link. */
  claimed: boolean;
  /** Where the request goes, as the file shows it (the email on the application). */
  sendTo: string | null;
  repName: string | null;
  /** An admin or the file's rep (who may send it back). */
  canAct: boolean;
  onChanged: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (!full?.signedAt) return null;
  const requests = versions?.requests ?? [];
  const list = versions?.versions ?? [];
  const open = requests.find((r) => r.status === "open") ?? null;
  const newest = list[0];
  const answered =
    newest && newest.version > 1
      ? requests.find((r) => r.result_version === newest.version)
      : undefined;
  // an update nobody has reviewed yet is looked at before anything else is asked
  const unreviewed = requests.some((r) => r.status === "submitted" && !r.reviewed_at);
  const canSendBack = canAct && !open && !unreviewed && !CLOSED_STAGES.has(stage);

  async function act(key: string, body: SendBackRequest, ask?: string) {
    if (busy) return;
    if (ask && !window.confirm(ask)) return;
    setBusy(key);
    setNote(null);
    try {
      const r = await postStaff(body);
      setNote({ ok: r.status !== "failed", text: r.detail });
      if (r.status !== "failed") setComposing(false);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't reach the server." });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function review(r: StaffChangeRequest) {
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy("review");
    const { error } = await sb.rpc("mark_changes_reviewed", { _request_id: r.id });
    setBusy(null);
    if (error) setNote({ ok: false, text: "Couldn't mark it reviewed. Try again." });
    onChanged();
  }

  async function pdf(v: StaffVersion) {
    if (busy) return;
    setBusy(`pdf:${v.version}`);
    void logActivity("download_pdf", { applicationId: fileId, detail: `version ${v.version}` });
    try {
      const x = await revealVersion(fileId, v.version);
      if (!x) throw new Error("That version isn't there.");
      const prev = list.find((p) => p.version === v.version - 1);
      await downloadApplicationPdf(
        {
          answers: null,
          first_name: x.details.owners[0]?.first ?? null,
          business_name: x.details.business.legal_name,
          phone: x.details.business.phone,
          email: x.details.business.email,
          amount_requested: null,
          repName,
        },
        detailsToPdf(
          x.details,
          {
            name: x.signedName,
            at: x.signedAt,
            image: x.signatureImage,
            name2: x.signedName2,
            image2: x.signatureImage2,
            via: x.signedVia,
            ip: x.signerIp,
            agent: x.signerAgent,
            consent: x.consentVersion,
            version: v.version,
            replaces: prev?.signed_at ?? null,
          },
          repName,
        ),
        "all",
        ` (version ${v.version})`,
      );
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't build that PDF." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className={cn(card, "p-6")}
      data-changes={open ? "open" : answered && !answered.reviewed_at ? "received" : "none"}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-lg font-semibold">Changes and versions</h3>
        {canSendBack && !composing && (
          <button
            type="button"
            className={cn(btnOutline, "ml-auto px-4 py-2")}
            onClick={() => {
              setComposing(true);
              setNote(null);
            }}
          >
            <RotateCcw className="size-4" /> Send back for changes
          </button>
        )}
      </div>

      {note && (
        <p
          className={cn("mt-3 text-sm", note.ok ? "text-forest" : "text-destructive")}
          role="status"
        >
          {note.text}
        </p>
      )}

      {composing && canSendBack && (
        <Composer
          details={full.details}
          stage={stage}
          claimed={claimed}
          sendTo={sendTo}
          busy={busy === "send"}
          onCancel={() => setComposing(false)}
          onSend={(items, message) =>
            void act("send", { action: "send_back", application_id: fileId, items, message })
          }
        />
      )}

      {open && (
        <OpenRequest
          r={open}
          busy={busy}
          canAct={canAct}
          onAgain={() =>
            void act(
              "again",
              { action: "send_back_again", request_id: open.id },
              open.channel === "email"
                ? "Email a new update link? The one sent before stops working."
                : "Email them again to sign in and update it?",
            )
          }
          onCancel={() => {
            const reason = window.prompt(
              "Cancel this request? The application they signed stands as it is. Why (optional, staff only):",
              "",
            );
            if (reason === null) return;
            void act("cancel", { action: "cancel_send_back", request_id: open.id, reason });
          }}
        />
      )}

      {answered && newest && (
        <WhatChanged
          request={answered}
          before={list.find((v) => v.version === newest.version - 1) ?? null}
          after={newest}
          busy={busy === "review"}
          canAct={canAct}
          onReview={() => void review(answered)}
        />
      )}

      {list.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
            Signed versions
          </p>
          <ul className="mt-2 space-y-2" data-versions={list.length}>
            {list.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-sand px-4 py-3 text-sm"
                data-version={v.version}
              >
                <FileText className="size-4 shrink-0 text-smoke" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    Version {v.version}
                    {v.version === list[0]?.version ? " (current)" : ""}
                  </span>
                  <span className="block text-xs text-smoke">
                    Signed {stamp(v.signed_at)} by {v.signed_name}
                    {v.signed_name_2 ? ` and ${v.signed_name_2}` : ""}
                    {v.signed_via === "link"
                      ? " · from a link"
                      : v.signed_via === "account"
                        ? " · from their account"
                        : ""}
                    {v.signer_ip ? ` · IP ${v.signer_ip}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={chip}
                  disabled={!!busy}
                  onClick={() => void pdf(v)}
                >
                  {busy === `pdf:${v.version}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  PDF
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-smoke">
            Each version stays exactly as signed. A PDF shows full SSNs, so opening one is recorded
            in the access log.
          </p>
        </div>
      )}

      {requests.filter((r) => r.status === "cancelled").length > 0 && (
        <p className="mt-4 text-xs text-smoke">
          Cancelled requests:{" "}
          {requests
            .filter((r) => r.status === "cancelled")
            .map((r) => `${stamp(r.cancelled_at)}${r.cancel_reason ? ` (${r.cancel_reason})` : ""}`)
            .join("; ")}
        </p>
      )}
    </section>
  );
}

function Composer({
  details,
  stage,
  claimed,
  sendTo,
  busy,
  onCancel,
  onSend,
}: {
  details: Details;
  stage: string;
  claimed: boolean;
  sendTo: string | null;
  busy: boolean;
  onCancel: () => void;
  onSend: (items: ChangeItem[], message: string | null) => void;
}) {
  const suggestions = useMemo(() => changeSuggestions(details), [details]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState<ChangeItem[]>([]);
  const [ownText, setOwnText] = useState("");
  const [ownSection, setOwnSection] = useState<ChangeSection>("other");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const items: ChangeItem[] = [
    ...suggestions.filter((s) => ticked.has(s.key)).map(({ key: _key, ...i }) => i),
    ...own,
  ];

  const addOwn = () => {
    const label = ownText.trim();
    if (label.length < 3) return setError("Write a few words for what's missing.");
    if (sensitiveText(label)) return setError("Leave SSNs out of what you ask.");
    setError("");
    setOwn((x) => [...x, { section: ownSection, label: label.slice(0, 140) }]);
    setOwnText("");
  };

  const send = () => {
    if (items.length > MAX_ITEMS) return setError(`At most ${MAX_ITEMS} items.`);
    if (!items.length && !message.trim())
      return setError("Tick what's missing or write a message.");
    if (sensitiveText(message)) return setError("Leave SSNs out of the message.");
    setError("");
    onSend(items, message.trim() || null);
  };

  return (
    <div className="mt-4 rounded-2xl bg-sand p-4 ring-1 ring-line sm:p-5" data-composer>
      <p className="text-sm font-semibold">What's missing?</p>
      <ul className="mt-3 space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.key}>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={ticked.has(s.key)}
                onChange={(e) =>
                  setTicked((t) => {
                    const n = new Set(t);
                    if (e.target.checked) n.add(s.key);
                    else n.delete(s.key);
                    return n;
                  })
                }
              />
              <span>
                {s.label}
                <span className="ml-1.5 text-xs text-smoke">{SECTION_LABEL[s.section]}</span>
              </span>
            </label>
          </li>
        ))}
        {own.map((o, i) => (
          <li key={`own-${i}`} className="flex items-center gap-2.5 text-sm">
            <Check className="size-4 shrink-0 text-forest" />
            <span className="flex-1">
              {o.label}
              <span className="ml-1.5 text-xs text-smoke">{SECTION_LABEL[o.section]}</span>
            </span>
            <button
              type="button"
              aria-label={`Remove ${o.label}`}
              className="text-smoke hover:text-ink"
              onClick={() => setOwn((x) => x.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className={cn(input, "min-w-0 flex-1")}
          placeholder="Something else, in words the merchant understands"
          value={ownText}
          maxLength={140}
          onChange={(e) => setOwnText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOwn();
            }
          }}
          aria-label="Something else that's missing"
        />
        <select
          className="rounded-full bg-white px-3 py-2 text-sm ring-1 ring-line"
          value={ownSection}
          onChange={(e) => setOwnSection(e.target.value as ChangeSection)}
          aria-label="Which part of the application"
        >
          {(Object.keys(SECTION_LABEL) as ChangeSection[]).map((k) => (
            <option key={k} value={k}>
              {SECTION_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="button" className={chip} onClick={addOwn}>
          Add
        </button>
      </div>
      <label className="mt-4 block text-sm">
        <span className="mb-1.5 block text-xs text-smoke">
          Message (optional; no SSNs). Left blank, the email says: "{defaultAsk(stage)}"
        </span>
        <textarea
          className={textarea}
          value={message}
          maxLength={MAX_MESSAGE}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Message to the merchant"
        />
      </label>
      <p className="mt-3 text-xs text-smoke">
        {claimed
          ? `They have a Lamp account: Lamp emails ${sendTo ?? "them"} to sign in and update it.`
          : `Lamp emails an update link to ${sendTo ?? "the email on the application"} from partners@getlamp.app, in your name. They confirm their date of birth to open it. Only they get the link.`}{" "}
        Nothing goes to funders until they sign the update or you cancel.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(btnPrimary, "px-4 py-2")}
          disabled={busy}
          onClick={send}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send back
        </button>
        <button
          type="button"
          className={cn(btnOutline, "px-4 py-2")}
          disabled={busy}
          onClick={onCancel}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function OpenRequest({
  r,
  busy,
  canAct,
  onAgain,
  onCancel,
}: {
  r: StaffChangeRequest;
  busy: string | null;
  canAct: boolean;
  onAgain: () => void;
  onCancel: () => void;
}) {
  const l = r.link;
  const steps = l
    ? [
        l.opened_at && `opened ${stamp(l.opened_at)}`,
        l.verified_at && "date of birth confirmed",
        l.started_at && "started",
      ].filter(Boolean)
    : [];
  return (
    <div className="mt-4 rounded-2xl bg-sand p-4 ring-1 ring-line" data-open-request>
      <p className="text-sm font-semibold">
        Sent back {stamp(r.created_at)}
        {r.requested_by_name ? ` by ${r.requested_by_name}` : ""}: waiting on the merchant
      </p>
      {r.message && <p className="mt-2 whitespace-pre-line text-sm">{r.message}</p>}
      {r.items.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
          {r.items.map((i) => (
            <li key={i.label}>{i.label}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-smoke">
        {r.channel === "account"
          ? `They update it from their Lamp account${r.notified_at ? ` · emailed ${stamp(r.notified_at)}` : ""}.`
          : l
            ? `Update link emailed to ${l.email ?? "them"} ${stamp(l.sent_at)}${steps.length ? ` · ${steps.join(", ")}` : " · not opened yet"} · works until ${stamp(l.expires_at)}`
            : "No update link went out yet: press Email again."}
        {r.sends > 1 ? ` · sent ${r.sends} times` : ""}
      </p>
      {l?.last_error && (
        <p className="mt-1 text-xs text-destructive">
          Email failed: {l.last_error}. Press Email again.
        </p>
      )}
      {l?.locked_at && (
        <p className="mt-1 text-xs text-destructive">
          Locked after 5 wrong dates of birth. Email again sends a new link, or call them.
        </p>
      )}
      {canAct && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className={chip} disabled={!!busy} onClick={onAgain}>
            {busy === "again" && <Loader2 className="size-3.5 animate-spin" />} Email again
          </button>
          <button
            type="button"
            className={cn(chip, "text-destructive")}
            disabled={!!busy}
            onClick={onCancel}
          >
            {busy === "cancel" && <Loader2 className="size-3.5 animate-spin" />} Cancel request
          </button>
        </div>
      )}
    </div>
  );
}

function WhatChanged({
  request,
  before,
  after,
  busy,
  canAct,
  onReview,
}: {
  request: StaffChangeRequest;
  before: StaffVersion | null;
  after: StaffVersion;
  busy: boolean;
  canAct: boolean;
  onReview: () => void;
}) {
  const changes = useMemo(
    () =>
      before
        ? diffDetails(
            versionDetails(before),
            versionDetails(after),
            after.secret_changes ?? undefined,
          )
        : [],
    [before, after],
  );
  const m = useMemo(() => matchItems(request.items, changes), [request.items, changes]);
  const reviewed = !!request.reviewed_at;
  const notAsked = new Set(m.also);
  const line = (c: Change) => (
    <li key={c.path} className="break-words" data-change={c.path}>
      <span className="font-semibold">{c.label}</span>
      <span className="text-smoke">
        {c.secret
          ? `: ${c.after}`
          : c.kind === "added"
            ? `: added ${c.after}`
            : c.kind === "removed"
              ? `: removed (was ${c.before})`
              : `: ${c.before} → ${c.after}`}
      </span>
      {(c.flag || c.secret) && (
        <span className="ml-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
          check before sending
        </span>
      )}
      {notAsked.has(c) && !c.flag && !c.secret && (
        <span className="ml-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-smoke ring-1 ring-line">
          not asked for
        </span>
      )}
    </li>
  );
  return (
    <div
      className={cn(
        "mt-4 rounded-2xl p-4 ring-1",
        reviewed ? "bg-white ring-line" : "bg-leaf/10 ring-leaf/40",
      )}
      data-what-changed={changes.length}
    >
      <p className="text-sm font-semibold">
        {reviewed ? "What changed in version " : "Changes received: version "}
        {after.version} signed {stamp(after.signed_at)} by {after.signed_name}
      </p>
      {m.asked.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-asked-items>
          {m.asked.map(({ item, changes: hit, byHand }) => (
            <li
              key={item.label}
              className={cn(
                "flex items-start gap-1.5 font-semibold",
                byHand ? "text-smoke" : hit.length ? "text-forest" : "text-destructive",
              )}
            >
              {byHand ? (
                <FileText className="mt-0.5 size-4 shrink-0" />
              ) : hit.length ? (
                <Check className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                {item.label}
                <span className="font-normal">
                  {byHand ? " · check by hand" : hit.length ? " · updated" : " · not changed"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {before?.signed_name_2 && !after.signed_name_2 && (
        <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          {before.signed_name_2} signed the version before but not this one: check before sending.
        </p>
      )}
      {changes.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
            {changes.length} answer{changes.length === 1 ? "" : "s"} changed
          </p>
          <ul className="mt-1.5 space-y-1">{changes.map(line)}</ul>
        </div>
      )}
      {changes.length === 0 && (
        <p className="mt-2 text-sm text-smoke">They signed it again without changing anything.</p>
      )}
      {reviewed ? (
        <p className="mt-3 text-xs text-smoke">
          Reviewed {stamp(request.reviewed_at)}
          {request.reviewed_by_name ? ` by ${request.reviewed_by_name}` : ""}.
        </p>
      ) : (
        canAct && (
          <button
            type="button"
            className={cn(btnPrimary, "mt-4 px-4 py-2")}
            disabled={busy}
            onClick={onReview}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Mark reviewed
          </button>
        )
      )}
    </div>
  );
}
