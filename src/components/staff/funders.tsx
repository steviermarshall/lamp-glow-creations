import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary, card } from "@/components/site/layout";
import { FUNDER_TYPE_LABEL, FUNDER_TYPES, parseMoney, usd, type FunderType } from "@/lib/money";
import { Field } from "@/components/staff/fields";
import { chip, input, listOf, textarea } from "@/components/staff/field-styles";

/**
 * Funders: the lenders Lamp submits files to, with what each one takes. Admins add and edit
 * them ("Admins manage funders"); reps read them. A file can only be sent to a funder on this
 * list, and a funded deal takes its commission points from here.
 */

export type FunderRow = {
  id: string;
  name: string;
  type: FunderType;
  active: boolean;
  paper_grades: string[];
  min_amount: number | null;
  max_amount: number | null;
  min_months_in_business: number | null;
  min_monthly_deposits: number | null;
  min_credit_score: number | null;
  max_positions: number | null;
  industries_excluded: string[];
  states_excluded: string[];
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  submission_email: string | null;
  portal_url: string | null;
  commission_points: number | null;
  notes: string | null;
};

export const FUNDER_COLUMNS =
  "id,name,type,active,paper_grades,min_amount,max_amount,min_months_in_business,min_monthly_deposits,min_credit_score,max_positions,industries_excluded,states_excluded,contact_name,contact_email,contact_phone,submission_email,portal_url,commission_points,notes";

type Draft = Record<
  | "name"
  | "type"
  | "paper_grades"
  | "min_amount"
  | "max_amount"
  | "min_months_in_business"
  | "min_monthly_deposits"
  | "min_credit_score"
  | "max_positions"
  | "industries_excluded"
  | "states_excluded"
  | "contact_name"
  | "contact_email"
  | "contact_phone"
  | "submission_email"
  | "portal_url"
  | "commission_points"
  | "notes",
  string
> & { active: boolean };

const EMPTY: Draft = {
  name: "",
  type: "direct",
  paper_grades: "",
  min_amount: "",
  max_amount: "",
  min_months_in_business: "",
  min_monthly_deposits: "",
  min_credit_score: "",
  max_positions: "",
  industries_excluded: "",
  states_excluded: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  submission_email: "",
  portal_url: "",
  commission_points: "",
  notes: "",
  active: true,
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const toDraft = (f: FunderRow): Draft => ({
  name: f.name,
  type: f.type,
  paper_grades: f.paper_grades.join(", "),
  min_amount: str(f.min_amount),
  max_amount: str(f.max_amount),
  min_months_in_business: str(f.min_months_in_business),
  min_monthly_deposits: str(f.min_monthly_deposits),
  min_credit_score: str(f.min_credit_score),
  max_positions: str(f.max_positions),
  industries_excluded: f.industries_excluded.join(", "),
  states_excluded: f.states_excluded.join(", "),
  contact_name: str(f.contact_name),
  contact_email: str(f.contact_email),
  contact_phone: str(f.contact_phone),
  submission_email: str(f.submission_email),
  portal_url: str(f.portal_url),
  commission_points: str(f.commission_points),
  notes: str(f.notes),
  active: f.active,
});

const intOrNull = (s: string) => {
  const n = Number(s.trim());
  return s.trim() && Number.isInteger(n) ? n : null;
};
const numOrNull = (s: string) => {
  const n = Number(s.trim());
  return s.trim() && Number.isFinite(n) ? n : null;
};
const textOrNull = (s: string) => s.trim() || null;

function toRow(d: Draft) {
  return {
    name: d.name.trim(),
    type: d.type as FunderType,
    active: d.active,
    paper_grades: listOf(d.paper_grades).map((g) => g.toUpperCase()),
    min_amount: parseMoney(d.min_amount),
    max_amount: parseMoney(d.max_amount),
    min_months_in_business: intOrNull(d.min_months_in_business),
    min_monthly_deposits: parseMoney(d.min_monthly_deposits),
    min_credit_score: intOrNull(d.min_credit_score),
    max_positions: intOrNull(d.max_positions),
    industries_excluded: listOf(d.industries_excluded),
    states_excluded: listOf(d.states_excluded).map((s) => s.toUpperCase()),
    contact_name: textOrNull(d.contact_name),
    contact_email: textOrNull(d.contact_email),
    contact_phone: textOrNull(d.contact_phone),
    submission_email: textOrNull(d.submission_email),
    portal_url: textOrNull(d.portal_url),
    commission_points: numOrNull(d.commission_points),
    notes: textOrNull(d.notes),
  };
}

export function Funders({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<FunderRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [reload, setReload] = useState(0);
  // Read apart from FUNDER_COLUMNS so this page keeps working before the funder-send
  // migration is applied: then these stay null and the sending controls are hidden.
  const [autoSend, setAutoSend] = useState<Record<string, boolean> | null>(null);
  const [mailbox, setMailbox] = useState<
    { mailbox: string; connected_at: string } | null | undefined
  >(undefined);
  const [mailNote, setMailNote] = useState("");
  // Whether the server has the Google client settings (yes/no only).
  const [googleReady, setGoogleReady] = useState<boolean | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("funders")
      .select(FUNDER_COLUMNS)
      .order("active", { ascending: false })
      .order("name")
      .then(({ data, error: e }) => {
        if (e) setError("Couldn't load funders. Refresh to try again.");
        setRows((data as FunderRow[] | null) ?? []);
      });
  }, [reload]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    void sb
      .from("funders")
      .select("id,auto_send")
      .then(({ data, error: e }) =>
        setAutoSend(
          e
            ? null
            : Object.fromEntries(
                ((data ?? []) as { id: string; auto_send: boolean }[]).map((r) => [
                  r.id,
                  r.auto_send,
                ]),
              ),
        ),
      );
    void fetch("/api/funders/send", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { google?: boolean } | null) => setGoogleReady(c ? !!c.google : null))
      .catch(() => setGoogleReady(null));
    void sb.rpc("mailer_status").then(({ data, error: e }) => {
      setMailbox(
        e ? undefined : (((data ?? []) as { mailbox: string; connected_at: string }[])[0] ?? null),
      );
    });
  }, [reload]);

  // Back from Google's consent screen: /staff?view=funders&mailbox=<outcome>.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("mailbox");
    if (!outcome) return;
    const say: Record<string, string> = {
      connected: "Mailbox connected. Files can now go out by email.",
      wrong_account:
        "That was a different Google account. Sign in as the Lamp mailbox and try again.",
      declined: "Google wasn't given permission, so nothing changed.",
      expired: "That link expired. Start again.",
      not_configured:
        "Sending isn't set up yet: the Google client settings are missing from the site's secrets (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).",
      no_refresh_token: "Google didn't grant lasting access. Start again and allow it.",
      send_not_allowed: "Google didn't grant permission to send email. Start again and tick it.",
    };
    setMailNote(say[outcome] ?? "Connecting the mailbox didn't finish. Start again.");
  }, []);

  async function connectMailbox() {
    const sb = getSupabase();
    if (!sb) return;
    setMailNote("");
    const session = (await sb.auth.getSession()).data.session;
    const res = session
      ? await fetch("/api/gmail/connect", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => null)
      : null;
    const body = (res ? await res.json().catch(() => ({})) : {}) as {
      url?: string;
      error?: string;
    };
    const url = body.url;
    if (!res || !res.ok || !url) {
      setMailNote(
        body.error ||
          "Couldn't start connecting the mailbox. Only an admin can, once sending is set up.",
      );
      return;
    }
    window.location.assign(url);
  }

  async function toggleAuto(f: FunderRow, on: boolean) {
    const sb = getSupabase();
    if (!sb) return;
    if (
      on &&
      !window.confirm(
        `Send matched files to ${f.name} automatically?\n\nOnce a file has its signed application and 3 bank statements, it goes to ${f.submission_email} with no one clicking Send.`,
      )
    ) {
      return;
    }
    const { error: e } = await sb.from("funders").update({ auto_send: on }).eq("id", f.id);
    if (e) {
      setError("Couldn't change automatic sending. Only admins can.");
      return;
    }
    setAutoSend((m) => ({ ...(m ?? {}), [f.id]: on }));
  }

  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    const sb = getSupabase();
    if (!sb) return;
    const row = toRow(draft);
    if (!row.name) {
      setError("A funder needs a name.");
      return;
    }
    if (row.min_amount !== null && row.max_amount !== null && row.min_amount > row.max_amount) {
      setError("Minimum amount is above the maximum.");
      return;
    }
    setSaving(true);
    setError("");
    const res =
      editing === "new"
        ? await sb.from("funders").insert(row)
        : await sb
            .from("funders")
            .update(row)
            .eq("id", editing ?? "");
    setSaving(false);
    if (res.error) {
      setError(
        res.error.code === "23505"
          ? "A funder with that name already exists."
          : "Couldn't save. Only admins can change funders.",
      );
      return;
    }
    setEditing(null);
    setReload((n) => n + 1);
  }

  if (rows === null) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-smoke" />
      </div>
    );
  }

  const shown = rows.filter((r) => showInactive || r.active);

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-smoke">
          {rows.filter((r) => r.active).length} active funders. A file can only go to a funder on
          this list.
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm text-smoke">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        {isAdmin && editing === null && (
          <button
            type="button"
            className={chip}
            onClick={() => {
              setDraft(EMPTY);
              setEditing("new");
              setError("");
            }}
          >
            Add funder
          </button>
        )}
      </div>
      {mailbox !== undefined && (
        <div className={cn(card, "flex flex-wrap items-center gap-3 p-4 text-sm")} data-mailbox>
          <span>
            {mailbox
              ? `Files go out by email from ${mailbox.mailbox}, connected ${new Date(mailbox.connected_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
              : "No sending mailbox yet, so files can't go out by email."}
          </span>
          {isAdmin && (
            <button
              type="button"
              className={cn(chip, "ml-auto")}
              onClick={() => void connectMailbox()}
            >
              {mailbox ? "Reconnect" : "Connect partners@getlamp.app"}
            </button>
          )}
          {googleReady === false && (
            <p className="w-full text-smoke">
              The server doesn't have the Google client settings yet, so the mailbox can't be
              connected.
            </p>
          )}
          {mailNote && <p className="w-full text-smoke">{mailNote}</p>}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing !== null && (
        <section className={cn(card, "p-6")} data-funder-form>
          <h3 className="font-display text-lg font-semibold">
            {editing === "new" ? "Add a funder" : `Edit ${draft.name}`}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={input}
                value={draft.name}
                onChange={(e) => set("name")(e.target.value)}
              />
            </Field>
            <Field label="Type">
              <select
                className={input}
                value={draft.type}
                onChange={(e) => set("type")(e.target.value)}
              >
                {FUNDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FUNDER_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commission points" hint="5 means 5% of the funded amount.">
              <input
                className={input}
                inputMode="decimal"
                value={draft.commission_points}
                onChange={(e) => set("commission_points")(e.target.value)}
              />
            </Field>
            <Field label="Paper grades" hint="Comma separated, e.g. A, B, C">
              <input
                className={input}
                value={draft.paper_grades}
                onChange={(e) => set("paper_grades")(e.target.value)}
              />
            </Field>
            <Field label="Minimum amount">
              <input
                className={input}
                value={draft.min_amount}
                onChange={(e) => set("min_amount")(e.target.value)}
              />
            </Field>
            <Field label="Maximum amount">
              <input
                className={input}
                value={draft.max_amount}
                onChange={(e) => set("max_amount")(e.target.value)}
              />
            </Field>
            <Field label="Minimum monthly deposits">
              <input
                className={input}
                value={draft.min_monthly_deposits}
                onChange={(e) => set("min_monthly_deposits")(e.target.value)}
              />
            </Field>
            <Field label="Minimum months in business">
              <input
                className={input}
                inputMode="numeric"
                value={draft.min_months_in_business}
                onChange={(e) => set("min_months_in_business")(e.target.value)}
              />
            </Field>
            <Field label="Minimum credit score">
              <input
                className={input}
                inputMode="numeric"
                value={draft.min_credit_score}
                onChange={(e) => set("min_credit_score")(e.target.value)}
              />
            </Field>
            <Field label="Most open positions it allows">
              <input
                className={input}
                inputMode="numeric"
                value={draft.max_positions}
                onChange={(e) => set("max_positions")(e.target.value)}
              />
            </Field>
            <Field label="Industries it won't fund" hint="Comma separated">
              <input
                className={input}
                value={draft.industries_excluded}
                onChange={(e) => set("industries_excluded")(e.target.value)}
              />
            </Field>
            <Field label="States it won't fund" hint="Comma separated, e.g. CA, VA">
              <input
                className={input}
                value={draft.states_excluded}
                onChange={(e) => set("states_excluded")(e.target.value)}
              />
            </Field>
            <Field label="Where files go (submission email)">
              <input
                className={input}
                type="email"
                value={draft.submission_email}
                onChange={(e) => set("submission_email")(e.target.value)}
              />
            </Field>
            <Field label="Funder portal link">
              <input
                className={input}
                value={draft.portal_url}
                onChange={(e) => set("portal_url")(e.target.value)}
              />
            </Field>
            <Field label="Contact name">
              <input
                className={input}
                value={draft.contact_name}
                onChange={(e) => set("contact_name")(e.target.value)}
              />
            </Field>
            <Field label="Contact phone">
              <input
                className={input}
                value={draft.contact_phone}
                onChange={(e) => set("contact_phone")(e.target.value)}
              />
            </Field>
            <Field label="Contact email">
              <input
                className={input}
                type="email"
                value={draft.contact_email}
                onChange={(e) => set("contact_email")(e.target.value)}
              />
            </Field>
            <Field label="Status">
              <select
                className={input}
                value={draft.active ? "active" : "inactive"}
                onChange={(e) => setDraft((d) => ({ ...d, active: e.target.value === "active" }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive (hidden when sending files)</option>
              </select>
            </Field>
            <Field label="Notes" wide>
              <textarea
                className={textarea}
                value={draft.notes}
                onChange={(e) => set("notes")(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className={cn(btnPrimary, "px-5 py-2.5")}
              disabled={saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save funder"}
            </button>
            <button type="button" className={chip} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {shown.length === 0 ? (
        <p className={cn(card, "p-6 text-sm text-smoke")}>
          No funders yet.{" "}
          {isAdmin
            ? "Add the funders Lamp sends files to, starting with the ones in your lender notes."
            : "An admin adds them."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((f) => (
            <li
              key={f.id}
              className={cn(card, "p-5 text-sm", !f.active && "opacity-60")}
              data-funder={f.name}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-base font-semibold">{f.name}</h3>
                <span className="text-smoke">{FUNDER_TYPE_LABEL[f.type]}</span>
                {!f.active && <span className="text-smoke">· inactive</span>}
                {f.commission_points !== null && (
                  <span className="text-smoke">· {f.commission_points} points</span>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className={cn(chip, "ml-auto")}
                    onClick={() => {
                      setDraft(toDraft(f));
                      setEditing(f.id);
                      setError("");
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
              <p className="mt-2 text-smoke">
                {[
                  f.min_amount !== null || f.max_amount !== null
                    ? `${usd(f.min_amount)} to ${usd(f.max_amount)}`
                    : "",
                  f.min_monthly_deposits !== null ? `${usd(f.min_monthly_deposits)}+ a month` : "",
                  f.min_months_in_business !== null
                    ? `${f.min_months_in_business}+ months in business`
                    : "",
                  f.min_credit_score !== null ? `${f.min_credit_score}+ credit` : "",
                  f.max_positions !== null ? `up to ${f.max_positions} positions` : "",
                  f.paper_grades.length ? `paper ${f.paper_grades.join("/")}` : "",
                  f.states_excluded.length ? `not in ${f.states_excluded.join(", ")}` : "",
                  f.industries_excluded.length ? `no ${f.industries_excluded.join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "No criteria recorded yet."}
              </p>
              {(f.submission_email || f.contact_name || f.portal_url) && (
                <p className="mt-1 text-smoke">
                  {[
                    f.submission_email && `Files to ${f.submission_email}`,
                    f.contact_name &&
                      `${f.contact_name}${f.contact_phone ? ` ${f.contact_phone}` : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {f.portal_url && (
                    <>
                      {" · "}
                      <a className="underline" href={f.portal_url} target="_blank" rel="noreferrer">
                        portal
                      </a>
                    </>
                  )}
                </p>
              )}
              {autoSend && f.active && (
                <p
                  className="mt-2 flex flex-wrap items-center gap-2 text-smoke"
                  data-auto-send={autoSend[f.id] ? "on" : "off"}
                >
                  {autoSend[f.id]
                    ? "Matched files go here automatically."
                    : "Files go here when someone clicks Send."}
                  {isAdmin && (
                    <button
                      type="button"
                      className={chip}
                      disabled={!autoSend[f.id] && !f.submission_email}
                      title={!f.submission_email ? "Add a submission email first" : undefined}
                      onClick={() => void toggleAuto(f, !autoSend[f.id])}
                    >
                      {autoSend[f.id] ? "Turn off automatic" : "Send automatically"}
                    </button>
                  )}
                </p>
              )}
              {f.notes && <p className="mt-2 whitespace-pre-line">{f.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
