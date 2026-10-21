import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { card } from "@/components/site/layout";
import {
  ENGINE_STATUS_LABEL,
  ENGINE_STATUSES,
  TIERS,
  signalSummary,
  tel,
  type EngineStatus,
} from "@/lib/engine-leads";

/**
 * Engine leads: businesses the public-record lead engine found and tiered (A is the dial
 * list), mirrored into this database by the engine itself. Staff read them here and record
 * what happened on the call; the engine never dials or sends, a person does.
 */

type Row = {
  id: number;
  name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  tier: string | null;
  need: number | null;
  reason: string | null;
  signals: unknown;
  status: string;
  notes: string;
  rep_slug: string | null;
  first_found: string | null;
  pushed_at: string;
  worked_at: string | null;
};

const COLUMNS =
  "id,name,phone,city,state,industry,tier,need,reason,signals,status,notes,rep_slug,first_found,pushed_at,worked_at";
const LIMIT = 300;

export function EngineLeads({
  isAdmin,
  repSlug,
  reps,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [tier, setTier] = useState<string>("A");
  const [status, setStatus] = useState<string>("new");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    setRows(null);
    setError("");
    (async () => {
      let q = sb.from("engine_leads").select(COLUMNS).not("phone", "is", null).neq("phone", "");
      if (tier) q = q.eq("tier", tier);
      if (status) q = q.eq("status", status);
      const { data, error: err } = await q
        .order("need", { ascending: false, nullsFirst: false })
        .order("first_found", { ascending: false })
        .order("id")
        .limit(LIMIT);
      if (!live) return;
      if (err) {
        setError("Couldn't load the engine leads. Refresh to try again.");
        setRows([]);
        return;
      }
      setRows(data as Row[]);
    })();
    return () => {
      live = false;
    };
  }, [tier, status, reload]);

  async function setLeadStatus(row: Row, next: EngineStatus) {
    const sb = getSupabase();
    if (!sb || next === row.status) return;
    setSaving(row.id);
    const { error: err } = await sb.from("engine_leads").update({ status: next }).eq("id", row.id);
    setSaving(null);
    if (err) {
      setError(`Couldn't save ${row.name ?? "that lead"}: ${err.message}`);
      return;
    }
    setRows((rs) =>
      rs
        ? rs.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: next,
                  worked_at: new Date().toISOString(),
                  rep_slug: r.rep_slug ?? repSlug,
                }
              : r,
          )
        : rs,
    );
  }

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : null;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Tier
          </span>
          <select
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t === "A" ? "A — dial first" : t}
              </option>
            ))}
            <option value="">All tiers</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Status
          </span>
          <select
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {ENGINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENGINE_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="">Any status</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-full px-4 py-2 text-sm font-semibold text-smoke ring-1 ring-line hover:text-ink"
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh
        </button>
        <p className="ml-auto text-sm text-smoke">
          {isAdmin ? "Every engine lead" : "The shared dial list"}
          {rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`}
        </p>
      </div>

      <p className="mt-3 text-xs text-smoke">
        Found by the lead engine from public records and tiered by need. Set the status after every
        call; it stamps the time and your rep slug. Nothing here dials or sends.
      </p>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className={cn(card, "mt-4 overflow-x-auto")}>
        {rows === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">
            No engine leads here. The engine pushes new batches after each weekly scout.
          </p>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
              <tr>
                <th className="px-4 py-3 font-semibold">Tier</th>
                <th className="px-4 py-3 font-semibold">Business</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Where</th>
                <th className="px-4 py-3 font-semibold">Why</th>
                <th className="px-4 py-3 font-semibold">Signals</th>
                <th className="px-4 py-3 font-semibold">Found</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Rep</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  data-engine-lead={r.id}
                  className="border-b border-line last:border-0 hover:bg-sand"
                >
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {r.tier ?? "—"}
                    {r.need != null && <span className="ml-1 text-xs text-smoke">{r.need}</span>}
                  </td>
                  <td className="max-w-[16rem] px-4 py-3 font-medium">
                    <div className="truncate">{r.name || "Unnamed business"}</div>
                    {r.industry && <div className="truncate text-xs text-smoke">{r.industry}</div>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.phone ? (
                      <a
                        href={`tel:${tel(r.phone)}`}
                        className="underline-offset-4 hover:text-amber-deep hover:underline"
                      >
                        {r.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-smoke">
                    {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="max-w-[18rem] px-4 py-3 text-smoke">
                    <span className="line-clamp-2">{r.reason || "—"}</span>
                  </td>
                  <td className="max-w-[14rem] px-4 py-3 text-xs text-smoke">
                    <span className="line-clamp-2">{signalSummary(r.signals) || "—"}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-smoke">
                    {r.first_found ?? age(r.pushed_at)}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                      value={r.status}
                      disabled={saving === r.id}
                      onChange={(e) => void setLeadStatus(r, e.target.value as EngineStatus)}
                      aria-label={`Status for ${r.name ?? "lead"}`}
                    >
                      {ENGINE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {ENGINE_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    {r.worked_at && (
                      <span className="ml-2 text-xs tabular-nums text-smoke">
                        {age(r.worked_at)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-smoke">{repName(r.rep_slug) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
