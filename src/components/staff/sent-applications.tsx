import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age, stamp } from "@/lib/staff";
import { btnPrimary, card } from "@/components/site/layout";
import { chip, input } from "@/components/staff/field-styles";
import { CopyButton, LinkTools, SendApplications } from "@/components/staff/send-applications";
import { applicationUrl, type SendRequest, type SendResult } from "@/lib/application-links";

/**
 * Applications: every application link sent, newest first, and where each one stands (sent,
 * opened, started, signed, stopped or expired). The database shows a rep only their own links
 * and an admin everyone's. A signed one opens as a file. Email again and New link both make a
 * fresh link, so the one sent before stops working; Stop ends a link without a new one.
 */

type Invite = {
  id: string;
  rep_slug: string;
  engine_lead_id: number | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  channel: string;
  sent_at: string;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  application_id: string | null;
  last_error: string | null;
};

const COLUMNS =
  "id,rep_slug,engine_lead_id,first_name,last_name,business_name,email,phone,channel,sent_at,opened_at,started_at,submitted_at,cancelled_at,expires_at,application_id,last_error";
const LIMIT = 200;

type Filter = "all" | "waiting" | "signed" | "stopped";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "signed", label: "Signed" },
  { id: "stopped", label: "Stopped or expired" },
];

type Status = "signed" | "stopped" | "expired" | "started" | "opened" | "sent";

/** Where a link stands, from its stamps; the latest step wins. */
function statusOf(r: Invite, now = Date.now()): Status {
  if (r.submitted_at) return "signed";
  if (r.cancelled_at) return "stopped";
  if (Date.parse(r.expires_at) < now) return "expired";
  if (r.started_at) return "started";
  if (r.opened_at) return "opened";
  return "sent";
}

const STATUS_LABEL: Record<Status, string> = {
  signed: "Signed",
  stopped: "Stopped",
  expired: "Expired",
  started: "Started",
  opened: "Opened",
  sent: "Sent",
};

const STATUS_CHIP: Record<Status, string> = {
  signed: "bg-leaf text-ink",
  stopped: "text-destructive ring-1 ring-line",
  expired: "text-destructive ring-1 ring-line",
  started: "text-forest ring-1 ring-line",
  opened: "text-forest ring-1 ring-line",
  sent: "text-smoke ring-1 ring-line",
};

type Outcome = { result?: SendResult; error?: string };

/** Resend or stop one link through the staff endpoint the send panel uses. */
async function postInvite(body: SendRequest): Promise<SendResult | null> {
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
  return data.results?.[0] ?? null;
}

export function SentApplications({
  isAdmin,
  repSlug,
  reps,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [rep, setRep] = useState("");
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // What the last action on each link did, kept across reloads so a new link stays copyable.
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [composing, setComposing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const now = new Date().toISOString();
    let q = sb.from("application_invites").select(COLUMNS);
    if (isAdmin && rep) q = q.eq("rep_slug", rep);
    if (filter === "signed") q = q.not("submitted_at", "is", null);
    if (filter === "waiting")
      q = q.is("submitted_at", null).is("cancelled_at", null).gte("expires_at", now);
    if (filter === "stopped")
      q = q.is("submitted_at", null).or(`cancelled_at.not.is.null,expires_at.lt."${now}"`);
    const { data, error: err } = await q.order("sent_at", { ascending: false }).limit(LIMIT);
    if (err) {
      setError(
        err.code === "42P01" || err.code === "PGRST205"
          ? "Application links aren't switched on in the database yet."
          : "Couldn't load the applications you've sent. Refresh to try again.",
      );
      setRows((r) => r ?? []);
      return;
    }
    setError("");
    setRows(data as Invite[]);
  }, [filter, rep, isAdmin]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "";

  async function act(inv: Invite, body: SendRequest, ask: string) {
    if (busy || !window.confirm(ask)) return;
    setBusy(inv.id);
    try {
      const result = await postInvite(body);
      setOutcomes((o) => ({
        ...o,
        [inv.id]: result ? { result } : { error: "The server didn't say what happened. Refresh." },
      }));
      await load();
    } catch (e) {
      setOutcomes((o) => ({
        ...o,
        [inv.id]: { error: e instanceof Error ? e.message : "Couldn't reach the server." },
      }));
    } finally {
      setBusy(null);
    }
  }

  const publicUrl = repSlug
    ? applicationUrl(typeof window === "undefined" ? "" : window.location.origin, repSlug)
    : "";
  const cols = isAdmin ? 7 : 6;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Status
          </span>
          <select
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
              Rep
            </span>
            <select
              className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
              value={rep}
              onChange={(e) => setRep(e.target.value)}
            >
              <option value="">All reps</option>
              {reps.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="rounded-full px-4 py-2 text-sm font-semibold text-smoke ring-1 ring-line hover:text-ink"
          onClick={() => void load()}
        >
          Refresh
        </button>
        <button
          type="button"
          className={cn(btnPrimary, "ml-auto px-4 py-2")}
          onClick={() => setComposing((k) => (k ?? 0) + 1)}
        >
          <Plus className="size-4" /> Send a new application
        </button>
      </div>

      <p className="mt-3 text-xs text-smoke">
        {isAdmin ? "Every application link the team has sent" : "The application links you've sent"}
        , newest first{rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`}. A signed one
        lands in Files with everything filled in. To send to leads, tick them on Engine leads.
      </p>

      {composing !== null && (
        <SendApplications
          key={composing}
          isAdmin={isAdmin}
          repSlug={repSlug}
          reps={reps}
          seed={[]}
          onClose={() => setComposing(null)}
          onSent={() => void load()}
        />
      )}

      <section className={cn(card, "mt-4 p-5")} data-public-link>
        <p className="text-sm font-semibold">Your public application link</p>
        {repSlug ? (
          <>
            <p className="mt-1 text-xs text-smoke">
              Works like a personal link, but nothing is filled in for them. Put it in your email
              signature, texts or bio: whoever signs from it lands in your files.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                readOnly
                aria-label="Your public application link"
                className={cn(input, "min-w-0 flex-1 font-mono text-xs sm:max-w-md")}
                value={publicUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton text={publicUrl} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-smoke">
            Your account has no rep link yet, so there's no public link. Ask an admin to link one.
          </p>
        )}
      </section>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className={cn(card, "mt-4 overflow-x-auto")}>
        {rows === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">
            {filter === "all"
              ? "No application links sent yet. Tick leads on Engine leads, or send one here."
              : "Nothing here with that status."}
          </p>
        ) : (
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
              <tr>
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">How</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Sent</th>
                {isAdmin && <th className="px-4 py-3 font-semibold">Rep</th>}
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {rows.map((r) => {
              const st = statusOf(r);
              const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
              const out = outcomes[r.id];
              const live = st !== "stopped" && st !== "expired";
              return (
                <tbody
                  key={r.id}
                  className="border-b border-line last:border-0"
                  data-invite={r.id}
                  data-invite-status={st}
                >
                  <tr className="hover:bg-sand">
                    <td className="max-w-[15rem] px-4 py-3">
                      <div className="truncate font-medium">{name || r.business_name || "—"}</div>
                      {name && r.business_name && (
                        <div className="truncate text-xs text-smoke">{r.business_name}</div>
                      )}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3 text-smoke">
                      {r.email && <div className="truncate">{r.email}</div>}
                      {r.phone && <div className="tabular-nums">{r.phone}</div>}
                      {!r.email && !r.phone && "—"}
                    </td>
                    <td className="px-4 py-3 text-smoke">
                      {r.channel === "email" ? "Emailed" : "Link"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-1 text-xs font-semibold",
                          STATUS_CHIP[st],
                        )}
                      >
                        {STATUS_LABEL[st]}
                      </span>
                      {st === "signed" && r.application_id && (
                        <Link
                          to="/staff"
                          search={{ file: r.application_id }}
                          className="ml-2 text-xs font-semibold text-forest underline-offset-4 hover:underline"
                        >
                          Open file
                        </Link>
                      )}
                      {st === "stopped" && r.last_error && (
                        <div className="mt-1 max-w-[14rem] text-xs text-destructive">
                          Email failed: {r.last_error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-smoke" title={stamp(r.sent_at)}>
                      {age(r.sent_at)}
                    </td>
                    {isAdmin && <td className="px-4 py-3 text-smoke">{repName(r.rep_slug)}</td>}
                    <td className="px-4 py-3">
                      {st !== "signed" && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {r.email && (
                            <button
                              type="button"
                              className={chip}
                              disabled={!!busy}
                              onClick={() =>
                                void act(
                                  r,
                                  { action: "resend", invite_id: r.id, channel: "email" },
                                  `Email ${r.email} a new link? The link sent before stops working.`,
                                )
                              }
                            >
                              Email again
                            </button>
                          )}
                          <button
                            type="button"
                            className={chip}
                            disabled={!!busy}
                            onClick={() =>
                              void act(
                                r,
                                { action: "resend", invite_id: r.id, channel: "link" },
                                "Make a new link to copy? The link sent before stops working.",
                              )
                            }
                          >
                            New link
                          </button>
                          {live && (
                            <button
                              type="button"
                              className={cn(chip, "text-destructive")}
                              disabled={!!busy}
                              onClick={() =>
                                void act(
                                  r,
                                  { action: "cancel", invite_id: r.id },
                                  "Stop this link? It won't open anymore. You can make a new one later.",
                                )
                              }
                            >
                              Stop
                            </button>
                          )}
                          {busy === r.id && (
                            <Loader2 className="size-4 animate-spin self-center text-smoke" />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {out && (
                    <tr>
                      <td colSpan={cols} className="px-4 pb-4">
                        <OutcomeLine out={out} invite={r} repName={repName(r.rep_slug)} />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
    </div>
  );
}

function OutcomeLine({
  out,
  invite: r,
  repName,
}: {
  out: Outcome;
  invite: Invite;
  repName: string;
}) {
  if (out.error) return <p className="text-sm text-destructive">{out.error}</p>;
  const res = out.result;
  if (!res) return null;
  if (res.status === "link" && res.url) {
    return (
      <div className="rounded-xl bg-sand p-3">
        <p className="text-xs font-semibold text-forest">{res.detail}</p>
        <LinkTools
          url={res.url}
          firstName={r.first_name ?? ""}
          businessName={r.business_name ?? ""}
          email={r.email ?? ""}
          phone={r.phone ?? ""}
          repName={repName}
        />
      </div>
    );
  }
  return (
    <p
      className={cn(
        "text-sm",
        res.status === "sent"
          ? "text-forest"
          : res.status === "cancelled"
            ? "text-smoke"
            : "text-destructive",
      )}
    >
      {res.status === "failed" ? `Email failed: ${res.detail}` : res.detail}
    </p>
  );
}
