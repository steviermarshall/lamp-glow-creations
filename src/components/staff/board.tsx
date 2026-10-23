import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age, STAGE_LABEL, STAGES, type Stage } from "@/lib/staff";
import { card } from "@/components/site/layout";

type Row = {
  id: string | null;
  status: Stage | null;
  rep_slug: string | null;
  business_name: string | null;
  first_name: string | null;
  created_at: string | null;
  document_count: number | null;
  documents_pending_review: number | null;
  last_activity_at: string | null;
  last_touch: string | null;
};

const COLUMNS =
  "id,status,rep_slug,business_name,first_name,created_at,document_count,documents_pending_review,last_activity_at,last_touch";
const LIMIT = 200;

/** Admin-only view filter. "mine" for a rep is always own + unassigned. */
export type RepFilter = "all" | "unassigned" | string;

export function Board({
  isAdmin,
  repSlug,
  stage,
  rep,
  reps,
  onStage,
  onRep,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  stage: Stage | undefined;
  rep: RepFilter;
  reps: { slug: string; name: string }[];
  onStage: (s: Stage | undefined) => void;
  onRep: (r: RepFilter) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    setRows(null);
    setError("");
    (async () => {
      let q = sb.from("pipeline_board").select(COLUMNS);
      // Policies already limit what a rep can read. Filtering rep_slug explicitly as well
      // lets Postgres use the (rep_slug, status, created_at) index (docs/database.md).
      if (!isAdmin) {
        q = repSlug ? q.or(`rep_slug.eq.${repSlug},rep_slug.is.null`) : q.is("rep_slug", null);
      } else if (rep === "unassigned") {
        q = q.is("rep_slug", null);
      } else if (rep !== "all") {
        q = q.eq("rep_slug", rep);
      }
      if (stage) q = q.eq("status", stage);
      const { data, error: err } = await q.order("created_at", { ascending: false }).limit(LIMIT);
      if (!live) return;
      if (err) {
        setError("Couldn't load the files. Refresh to try again.");
        setRows([]);
        return;
      }
      setRows(data as Row[]);
    })();
    return () => {
      live = false;
    };
  }, [isAdmin, repSlug, stage, rep]);

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : null;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Stage
          </span>
          <select
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
            value={stage ?? ""}
            onChange={(e) => onStage((e.target.value || undefined) as Stage | undefined)}
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
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
              onChange={(e) => onRep(e.target.value)}
            >
              <option value="all">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {reps.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="ml-auto text-sm text-smoke">
          {isAdmin ? "All files" : "Your files and the unassigned pool"}
          {rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`}
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className={cn(card, "mt-4 overflow-x-auto")}>
        {rows === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">No files here.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
              <tr>
                <th className="px-4 py-3 font-semibold">Business</th>
                <th className="px-4 py-3 font-semibold">First name</th>
                <th className="px-4 py-3 font-semibold">Rep</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Age</th>
                <th className="px-4 py-3 font-semibold">Documents</th>
                <th className="px-4 py-3 font-semibold">Last touch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  data-file={r.id}
                  className="border-b border-line last:border-0 hover:bg-sand"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to="/staff"
                      search={{ file: r.id ?? undefined }}
                      className="underline-offset-4 hover:text-forest hover:underline"
                    >
                      {r.business_name || "Unnamed business"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.first_name || "—"}</td>
                  <td className="px-4 py-3">
                    {repName(r.rep_slug) ?? (
                      <span className="rounded-full bg-leaf/15 px-2.5 py-1 text-xs font-semibold text-forest">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.status ? STAGE_LABEL[r.status] : "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-smoke">{age(r.created_at)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.document_count ?? 0}
                    {(r.documents_pending_review ?? 0) > 0 && (
                      <span className="ml-2 text-xs text-forest">
                        {r.documents_pending_review} to review
                      </span>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-4 py-3 text-smoke">
                    <span className="tabular-nums">{age(r.last_activity_at)}</span>
                    {r.last_touch && <span className="ml-2 truncate">· {r.last_touch}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
