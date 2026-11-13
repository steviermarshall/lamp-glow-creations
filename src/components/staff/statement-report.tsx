import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { chipButton, input } from "@/components/staff/field-styles";
import { postAsMe } from "@/lib/server-api";
import { ordinal, type Figures } from "@/lib/statement-read";

/**
 * The statement report on a file (staff): Lamp reads each bank statement with Claude, works out
 * the numbers funders ask for in plain code, and checks every statement adds up. The rep or an
 * admin looks it over, fixes any number, and confirms. Statements are read one per request, so
 * the button walks through them and the card fills in as each one lands.
 */

type Statement = {
  document_id: string;
  name: string;
  state: "unread" | "read" | "failed";
  error: string | null;
  readable: boolean;
};
type Report = {
  figures: Figures;
  confirmed: Figures | null;
  edits: Record<string, [number | null, number]>;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
};
type State = { on: boolean; paused: boolean; statements: Statement[]; report: Report | null };

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "Unknown" : `$${Math.round(n).toLocaleString("en-US")}`;

const FIELDS: {
  key:
    | "avg_monthly_revenue"
    | "avg_daily_balance"
    | "nsf_max_month"
    | "negative_days"
    | "position_fit";
  label: string;
  money?: boolean;
}[] = [
  { key: "avg_monthly_revenue", label: "Monthly revenue", money: true },
  { key: "avg_daily_balance", label: "Average daily balance", money: true },
  { key: "nsf_max_month", label: "Most NSFs in a month" },
  { key: "negative_days", label: "Negative days" },
  { key: "position_fit", label: "Position fit" },
];

export function StatementReport({ fileId }: { fileId: string }) {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // One read run or one confirm at a time, even if the button is pressed again before the redraw.
  const working = useRef(false);
  const root = useRef<HTMLElement>(null);

  // When the button a person pressed goes away (every statement read, or the report confirmed), a
  // browser drops keyboard focus on the page. Bring it back to this card so they keep their place.
  const keepFocus = () =>
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (!at || at === document.body) root.current?.focus({ preventScroll: true });
    });

  const call = useCallback(
    async (body: object) => {
      const r = await postAsMe<State>("/api/statements", { application_id: fileId, ...body });
      if (r.data.statements) setS(r.data as State);
      return r;
    },
    [fileId],
  );

  useEffect(() => {
    void call({ action: "get" }).then((r) => {
      if (!r.ok) setError(r.data.error ?? "Couldn't load the statement report.");
    });
  }, [call]);

  if (!s)
    return (
      <section className={cn(card, "p-6")} data-statement-report="loading">
        <h3 className="font-display text-lg font-semibold">Statement report</h3>
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : (
          <Loader2 className="mt-3 size-4 animate-spin text-smoke" />
        )}
      </section>
    );

  const todo = s.statements.filter((x) => x.readable && x.state !== "read");
  const f = s.report?.confirmed ?? s.report?.figures ?? null;

  async function readAll() {
    if (working.current) return;
    working.current = true;
    setError("");
    try {
      for (const st of todo) {
        setReading(st.document_id);
        const r = await call({ action: "read", document_id: st.document_id });
        if (!r.ok && r.status !== 502) {
          setError(r.data.error ?? "Couldn't read that statement.");
          break;
        }
      }
    } finally {
      working.current = false;
      setReading(null);
      keepFocus();
    }
  }

  async function confirm() {
    if (working.current) return;
    working.current = true;
    setSaving(true);
    setError("");
    const numbers: Record<string, number> = {};
    for (const fl of FIELDS) {
      const raw = draft[fl.key];
      if (raw === undefined || raw.trim() === "") continue;
      numbers[fl.key] = Number(raw.replace(/[$,\s]/g, ""));
    }
    let r: Awaited<ReturnType<typeof call>>;
    try {
      r = await call({ action: "confirm", numbers });
    } finally {
      working.current = false;
      setSaving(false);
    }
    if (!r.ok) return setError(r.data.error ?? "Couldn't confirm the report.");
    setEditing(false);
    setDraft({});
    keepFocus();
  }

  return (
    <section
      ref={root}
      tabIndex={-1}
      className={cn(card, "p-6")}
      data-statement-report={s.report?.confirmed ? "confirmed" : f ? "read" : "none"}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-display text-lg font-semibold">Statement report</h3>
        {s.report?.confirmed && s.report.confirmed_at && (
          <span className="text-sm font-semibold text-forest">
            Confirmed{s.report.confirmed_by_name ? ` by ${s.report.confirmed_by_name}` : ""} ·{" "}
            {stamp(s.report.confirmed_at)}
          </span>
        )}
      </div>

      {s.statements.length === 0 ? (
        <p className="mt-2 text-sm text-smoke">No bank statements on this file yet.</p>
      ) : !s.on ? (
        <p className="mt-2 text-sm text-smoke">
          The statement reader is off until an admin adds Lamp&apos;s Anthropic key in Staff, AI
          activity. {s.statements.length} statement
          {s.statements.length === 1 ? "" : "s"} waiting.
        </p>
      ) : (
        todo.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={chipButton}
              // While it reads the button says so (aria-busy) and stays in place; switching it off
              // would throw a keyboard user's focus back to the top of the page.
              disabled={s.paused}
              aria-disabled={!!reading || undefined}
              aria-busy={!!reading || undefined}
              onClick={() => void readAll()}
            >
              {reading ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {reading
                ? `Reading ${s.statements.findIndex((x) => x.document_id === reading) + 1} of ${s.statements.length}…`
                : f
                  ? `Read ${todo.length} more statement${todo.length === 1 ? "" : "s"}`
                  : "Read statements"}
            </button>
            {s.paused && (
              <span className="text-xs text-smoke">
                Paused: this month's reading budget is used up.
              </span>
            )}
            {!reading && <span className="text-xs text-smoke">About a minute a statement.</span>}
          </div>
        )
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {f && (
        <>
          <div
            className={cn(
              "mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
              f.verified ? "bg-leaf/15 text-forest" : "bg-sand",
            )}
          >
            {f.verified ? (
              <Check className="mt-0.5 size-4 shrink-0" />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {f.verified
                ? `${f.months} statement${f.months === 1 ? "" : "s"} read, every one adds up${f.period_start ? ` (${f.period_start} to ${f.period_end})` : ""}.`
                : "Not verified: check the flagged statements by hand before trusting these numbers."}
            </span>
          </div>

          {editing ? (
            <div className="mt-4 grid gap-3 text-sm">
              {FIELDS.map((fl) => (
                <label key={fl.key} className="grid grid-cols-[10rem_1fr] items-center gap-2">
                  <span className="text-smoke">{fl.label}</span>
                  <input
                    id={`stmt-${fl.key}`}
                    className={input}
                    inputMode="decimal"
                    placeholder={f[fl.key] === null ? "Unknown" : String(f[fl.key])}
                    value={draft[fl.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [fl.key]: e.target.value }))}
                  />
                </label>
              ))}
              <p className="text-xs text-smoke">Leave a box empty to keep the number shown.</p>
            </div>
          ) : (
            <dl className="mt-4 space-y-2 text-sm">
              <Row
                label="Monthly revenue"
                value={usd(f.avg_monthly_revenue)}
                note={
                  f.avg_monthly_deposits !== f.avg_monthly_revenue
                    ? `${usd(f.avg_monthly_deposits)} deposited, less transfers and funding`
                    : undefined
                }
                edited={!!s.report?.edits["avg_monthly_revenue"]}
              />
              <Row label="Deposits a month" value={String(f.avg_deposit_count)} />
              <Row
                label="Average daily balance"
                value={usd(f.avg_daily_balance)}
                edited={!!s.report?.edits["avg_daily_balance"]}
              />
              <Row
                label="NSFs"
                value={`${f.nsf_total} in all, ${f.nsf_max_month} in the worst month`}
                edited={!!s.report?.edits["nsf_max_month"]}
              />
              <Row
                label="Negative days"
                value={f.negative_days === null ? "Unknown" : String(f.negative_days)}
                edited={!!s.report?.edits["negative_days"]}
              />
              <Row
                label="Position fit"
                value={`${ordinal(f.position_fit)} position`}
                edited={!!s.report?.edits["position_fit"]}
              />
              {f.holdback > 0 && (
                <Row
                  label="Already paying out"
                  value={`${Math.round(f.holdback * 100)}% of revenue`}
                />
              )}
            </dl>
          )}

          {f.positions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-smoke">
                Funders being paid
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {f.positions.map((p) => (
                  <li key={p.description} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold break-all">{p.description}</span>
                    <span className="text-smoke">
                      {usd(p.payment)}{" "}
                      {p.cadence === "other" ? "(not a regular payment)" : p.cadence}, last{" "}
                      {p.last_date}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {f.flags.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-sm">
              {f.flags.map((x) => (
                <li key={x} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-smoke" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  className={chipButton}
                  aria-disabled={saving || undefined}
                  aria-busy={saving || undefined}
                  onClick={() => void confirm()}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}{" "}
                  Save and confirm
                </button>
                <button
                  type="button"
                  className={chipButton}
                  onClick={() => (setEditing(false), setDraft({}))}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {!s.report?.confirmed && (
                  <button
                    type="button"
                    className={chipButton}
                    disabled={!!reading}
                    aria-disabled={saving || undefined}
                    aria-busy={saving || undefined}
                    onClick={() => void confirm()}
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}{" "}
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  className={chipButton}
                  disabled={!!reading}
                  onClick={() => setEditing(true)}
                >
                  {s.report?.confirmed ? "Change a number" : "Fix a number"}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {s.statements.length > 0 && (
        <ul className="mt-5 space-y-1 border-t border-line pt-3 text-xs text-smoke">
          {s.statements.map((st) => (
            <li key={st.document_id} className="flex flex-wrap gap-x-2">
              <span className="break-all">{st.name}</span>
              <span>
                ·{" "}
                {!st.readable
                  ? "can't be read (ask for a PDF)"
                  : st.state === "read"
                    ? "read"
                    : st.state === "failed"
                      ? `didn't read: ${st.error ?? "unknown error"}`
                      : "not read yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  note,
  edited,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  edited?: boolean;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2">
      <dt className="text-smoke">{label}</dt>
      <dd className="font-semibold">
        {value}
        {edited && <span className="ml-2 text-xs font-normal text-smoke">(changed by hand)</span>}
        {note && <span className="block text-xs font-normal text-smoke">{note}</span>}
      </dd>
    </div>
  );
}
