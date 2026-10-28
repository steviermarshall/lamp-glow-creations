import { useEffect, useState, type DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Columns3, List, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/track";
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

type Layout = "kanban" | "list";
const LAYOUT_KEY = "lamp.staff.board.layout";
/** Lanes that end a file; shown on the Kanban only when asked for. */
const CLOSED: readonly Stage[] = ["declined", "withdrawn", "closed"];
const OPEN_STAGES = STAGES.filter((s) => !CLOSED.includes(s));
/** A file nobody has touched for this long gets flagged on its card. */
const STALE_MS = 3 * 86_400_000;

function savedLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "kanban";
  } catch {
    return "kanban";
  }
}

/**
 * The files: a Kanban with a lane per stage (drag a card, or use its Move menu, to change the
 * stage) or the list. Which one is remembered in this browser. Stage changes write the file the
 * same way the file view does, so the database's rules decide who can move what.
 */
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
  reps: { slug: string; name: string; admin_slug?: string | null }[];
  onStage: (s: Stage | undefined) => void;
  onRep: (r: RepFilter) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [layout, setLayoutState] = useState<Layout>("kanban");
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => setLayoutState(savedLayout()), []);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      window.localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* remembered for this visit only */
    }
  };
  // the Kanban's lanes are the stages, so it always loads every stage
  const stageFilter = layout === "list" ? stage : undefined;

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
      if (stageFilter) q = q.eq("status", stageFilter);
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
  }, [isAdmin, repSlug, stageFilter, rep]);

  /** The rep, with their admin's team when they report to one: "Zeus · Stevie's team". */
  const repName = (slug: string | null) => {
    if (!slug) return null;
    const r = reps.find((x) => x.slug === slug);
    const lead = r?.admin_slug ? reps.find((x) => x.slug === r.admin_slug)?.name : null;
    return `${r?.name ?? slug}${lead ? ` · ${lead.split(" ")[0]}'s team` : ""}`;
  };

  /** Moves a file to a stage: on the board at once, put back if the database refuses. */
  async function move(id: string, to: Stage) {
    const before = rows?.find((r) => r.id === id);
    if (!before || before.status === to) return;
    setError("");
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, status: to } : r)) ?? rs);
    const sb = getSupabase();
    const res = sb
      ? await sb.from("applications").update({ status: to }).eq("id", id).select("id")
      : null;
    if (!res || res.error || res.data.length !== 1) {
      setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, status: before.status } : r)) ?? rs);
      setError(
        `${before.business_name || "That file"} couldn't move. You may not have access to it.`,
      );
      return;
    }
    void logActivity("change_stage", { applicationId: id, detail: to });
  }

  const count = rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label="Board layout"
          className="flex rounded-full bg-white p-1 ring-1 ring-line"
        >
          {(
            [
              ["kanban", "Kanban", Columns3],
              ["list", "List", List],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={layout === id}
              data-board-layout={id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
                layout === id ? "bg-ink text-white" : "text-smoke hover:text-ink",
              )}
              onClick={() => setLayout(id)}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {layout === "list" ? (
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
        ) : (
          <label className="flex items-center gap-2 self-center text-sm text-smoke">
            <input
              type="checkbox"
              className="size-4"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Show declined, withdrawn and closed
          </label>
        )}
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
          {count}
        </p>
      </div>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {rows === null ? (
        <div className={cn(card, "mt-4 grid place-items-center py-16")}>
          <Loader2 className="size-6 animate-spin text-smoke" />
        </div>
      ) : layout === "kanban" ? (
        <Kanban
          rows={rows}
          stages={showClosed ? STAGES : OPEN_STAGES}
          repName={isAdmin ? repName : null}
          onMove={(id, to) => void move(id, to)}
        />
      ) : (
        <ListView rows={rows} repName={repName} />
      )}
    </div>
  );
}

function Kanban({
  rows,
  stages,
  repName,
  onMove,
}: {
  rows: Row[];
  stages: readonly Stage[];
  /** Admins see whose file each card is; a rep's cards are their own or unassigned. */
  repName: ((slug: string | null) => string | null) | null;
  onMove: (id: string, to: Stage) => void;
}) {
  const [over, setOver] = useState<Stage | null>(null);
  const drop = (to: Stage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-lamp-file");
    if (id) onMove(id, to);
  };
  return (
    <div className="mt-4 overflow-x-auto pb-3" data-kanban>
      <div className="flex min-w-max gap-3">
        {stages.map((s) => {
          const lane = rows.filter((r) => r.status === s);
          return (
            <section
              key={s}
              aria-label={`${STAGE_LABEL[s]}: ${lane.length}`}
              data-lane={s}
              className={cn(
                card,
                "flex w-[17rem] shrink-0 flex-col p-2.5 transition",
                over === s && "ring-2 ring-leaf",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== s) setOver(s);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={drop(s)}
            >
              <h3 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-smoke">
                {STAGE_LABEL[s]}
                <span className="rounded-full bg-sand px-2 py-0.5 tabular-nums">{lane.length}</span>
              </h3>
              <ul className="flex min-h-24 flex-col gap-2">
                {lane.map((r) => (
                  <KanbanCard key={r.id} row={r} repName={repName} onMove={onMove} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  row: r,
  repName,
  onMove,
}: {
  row: Row;
  repName: ((slug: string | null) => string | null) | null;
  onMove: (id: string, to: Stage) => void;
}) {
  const idle = r.last_activity_at ? Date.now() - Date.parse(r.last_activity_at) : 0;
  const stale =
    idle > STALE_MS && !!r.status && !CLOSED.includes(r.status) && r.status !== "funded";
  const toReview = r.documents_pending_review ?? 0;
  return (
    <li
      draggable={!!r.id}
      data-file={r.id}
      onDragStart={(e) => {
        if (!r.id) return;
        e.dataTransfer.setData("text/x-lamp-file", r.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-xl bg-white p-3 text-sm ring-1 ring-line transition hover:ring-ink/30 active:cursor-grabbing"
    >
      <Link
        to="/staff"
        search={{ file: r.id ?? undefined }}
        className="block font-semibold leading-snug underline-offset-4 hover:text-forest hover:underline"
      >
        {r.business_name || "Unnamed business"}
      </Link>
      <p className="mt-0.5 text-xs text-smoke">
        {r.first_name || "No name"}
        {repName &&
          (repName(r.rep_slug) ? (
            ` · ${repName(r.rep_slug)}`
          ) : (
            <span className="ml-1.5 rounded-full bg-leaf/15 px-2 py-0.5 font-semibold text-forest">
              Unassigned
            </span>
          ))}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-smoke">
        <span className="tabular-nums">{r.document_count ?? 0} docs</span>
        {toReview > 0 && <span className="font-semibold text-forest">{toReview} to review</span>}
        <span className="tabular-nums">· opened {age(r.created_at)} ago</span>
      </p>
      {stale && (
        <p className="mt-1.5 text-xs font-semibold text-destructive" data-stale>
          No touch in {age(r.last_activity_at)}
        </p>
      )}
      {r.last_touch && <p className="mt-1.5 truncate text-xs text-smoke">{r.last_touch}</p>}
      {r.id && r.status && (
        <select
          aria-label={`Move ${r.business_name || "this file"} to a stage`}
          className="mt-2 w-full rounded-full bg-sand px-3 py-1 text-xs ring-1 ring-line"
          value={r.status}
          onChange={(e) => onMove(r.id!, e.target.value as Stage)}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s === r.status ? `Stage: ${STAGE_LABEL[s]}` : `Move to ${STAGE_LABEL[s]}`}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

function ListView({
  rows,
  repName,
}: {
  rows: Row[];
  repName: (slug: string | null) => string | null;
}) {
  return (
    <div className={cn(card, "mt-4 overflow-x-auto")}>
      {rows.length === 0 ? (
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
  );
}
