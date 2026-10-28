import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, UserPlus } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { btnPrimary, card } from "@/components/site/layout";
import { chip, input } from "@/components/staff/field-styles";
import type { TeamRow } from "@/lib/team.server";

/**
 * Team (admins only): add reps by name and email, pick the admin each one reports to, make
 * someone an admin, switch a rep off, resend the welcome email. A rep who reports to an admin
 * sends applications in that admin's name; the signed file still lands in the rep's own files,
 * so the rep works the deal and the admin sees on every file which rep sent it.
 */

async function call(method: "GET" | "POST", body?: unknown) {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const res = await fetch("/api/team", {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as {
    team?: TeamRow[];
    row?: TeamRow;
    emailed?: boolean;
    email_error?: string | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

export function Team({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [lead, setLead] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await call("GET")).team ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the team.");
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const admins = (rows ?? []).filter((r) => r.is_admin && r.active);

  async function act(
    key: string,
    body: Record<string, unknown>,
    done: (d: Awaited<ReturnType<typeof call>>) => string,
  ) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      const d = await call("POST", body);
      setNote(done(d));
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await act(
      "add",
      {
        action: "add",
        name: name.trim(),
        email: email.trim(),
        admin_slug: lead || null,
        make_admin: makeAdmin,
      },
      (d) =>
        `Added ${d.row?.name ?? name}.` +
        (d.emailed
          ? ` Welcome email sent to ${d.row?.email}.`
          : ` The welcome email didn't go out (${d.email_error ?? "unknown error"}); use Resend invite.`),
    );
    if (ok) {
      setName("");
      setEmail("");
      setMakeAdmin(false);
    }
  }

  return (
    <div className="mt-8 space-y-4" data-team>
      <section className={cn(card, "p-5 sm:p-6")}>
        <h2 className="font-display text-lg font-semibold">Add a rep</h2>
        <p className="mt-1 max-w-3xl text-sm text-smoke">
          Lamp emails them from partners@getlamp.app with how to sign in and their two application
          links. If they report to an admin, the applications they send go out in that admin's name,
          and the signed files land in the rep's own files.
        </p>
        <form
          onSubmit={add}
          className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.4fr_1fr_auto_auto] md:items-end"
        >
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
              Full name
            </span>
            <input
              id="team-name"
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
              Email
            </span>
            <input
              id="team-email"
              type="email"
              className={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
              Reports to
            </span>
            <select
              id="team-lead"
              className={input}
              value={lead}
              onChange={(e) => setLead(e.target.value)}
            >
              <option value="">Nobody (sends in their own name)</option>
              {admins.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              id="team-admin"
              type="checkbox"
              className="size-4"
              checked={makeAdmin}
              onChange={(e) => setMakeAdmin(e.target.checked)}
            />
            Make admin
          </label>
          <button
            type="submit"
            className={cn(btnPrimary, "px-5 py-2.5")}
            disabled={busy === "add" || !name.trim() || !email.trim()}
          >
            {busy === "add" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Add and email
          </button>
        </form>
      </section>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="text-sm text-forest" role="status">
          {note}
        </p>
      )}

      <section className={cn(card, "overflow-x-auto")}>
        {rows === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
              <tr>
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold">Sign-in</th>
                <th className="px-4 py-3 font-semibold">Reports to</th>
                <th className="px-4 py-3 font-semibold">Admin</th>
                <th className="px-4 py-3 font-semibold">On the team</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.slug}
                  data-team-row={r.slug}
                  className={cn("border-b border-line last:border-0", !r.active && "opacity-60")}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-smoke">
                      {r.email ?? "No email"} · /{r.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-smoke">
                    {r.linked
                      ? "Signed in"
                      : r.invited_at
                        ? `Invited ${age(r.invited_at)} ago`
                        : "No login yet"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Who ${r.name} reports to`}
                      className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-line"
                      value={r.admin_slug ?? ""}
                      disabled={!!busy}
                      onChange={(e) => {
                        // read it now: the controlled select snaps back until the team reloads
                        const lead = e.target.value;
                        void act(
                          `lead:${r.slug}`,
                          { action: "update", slug: r.slug, admin_slug: lead || null },
                          () =>
                            lead
                              ? `${r.name} now reports to ${rows.find((x) => x.slug === lead)?.name}. Their applications go out in that name.`
                              : `${r.name} now sends in their own name.`,
                        );
                      }}
                    >
                      <option value="">Nobody</option>
                      {admins
                        .filter((a) => a.slug !== r.slug)
                        .map((a) => (
                          <option key={a.slug} value={a.slug}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`${r.name} is an admin`}
                      checked={r.is_admin}
                      disabled={!!busy}
                      onChange={(e) => {
                        const on = e.target.checked;
                        void act(
                          `admin:${r.slug}`,
                          { action: "update", slug: r.slug, make_admin: on },
                          () =>
                            on ? `${r.name} is now an admin.` : `${r.name} is no longer an admin.`,
                        );
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`${r.name} is on the team`}
                      checked={r.active}
                      disabled={!!busy}
                      onChange={(e) => {
                        const on = e.target.checked;
                        void act(
                          `active:${r.slug}`,
                          { action: "update", slug: r.slug, active: on },
                          () =>
                            on
                              ? `${r.name} is back on the team.`
                              : `${r.name} is off the team: their links stop working.`,
                        );
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!r.linked && r.email && (
                      <button
                        type="button"
                        className={chip}
                        disabled={!!busy}
                        onClick={() =>
                          void act(
                            `invite:${r.slug}`,
                            { action: "invite", slug: r.slug },
                            () => `Welcome email sent again to ${r.email}.`,
                          )
                        }
                      >
                        <Mail className="size-3.5" /> Resend invite
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
