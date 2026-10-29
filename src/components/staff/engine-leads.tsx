import { useEffect, useState } from "react";
import { Download, Loader2, Search, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { SendApplications, type SendSeed } from "@/components/staff/send-applications";
import { MAX_RECIPIENTS } from "@/lib/application-links";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  BOARD_ORIGINS,
  ENGINE_STATUS_LABEL,
  ENGINE_STATUSES,
  TIERS,
  boardBatch,
  leadsFromCsv,
  leadsToCsv,
  searchFilter,
  signalSummary,
  tel,
  type EngineStatus,
} from "@/lib/engine-leads";

/**
 * Engine leads: businesses the public-record lead engine found and tiered (A is the dial
 * list). The engine runs outside Lamp; an admin picks leads there, downloads them with the rep
 * each one goes to, and uploads the file here. A rep sees and works only their own leads and
 * records what happened on the call; the engine never dials or sends, a person does.
 * Ticking leads opens Send the application: one personal link each, by email or to copy.
 * Search looks through name, phone, email, city and industry within the tier and status
 * picked; admins can also download the ticked leads as a CSV.
 */

type Row = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
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
  "id,name,phone,email,city,state,industry,tier,need,reason,signals,status,notes,rep_slug,first_found,pushed_at,worked_at";
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
  const [tier, setTier] = useState<string>(isAdmin ? "A" : "");
  const [status, setStatus] = useState<string>("new");
  const [search, setSearch] = useState("");
  // what the list was last loaded for: the box waits for a pause in typing
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // The send panel, keyed so picking again starts it fresh with the new picks.
  const [sending, setSending] = useState<{ key: number; seed: SendSeed[] } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    setRows(null);
    setError("");
    setSelected(new Set());
    (async () => {
      let q = sb.from("engine_leads").select(COLUMNS).not("phone", "is", null).neq("phone", "");
      if (tier) q = q.eq("tier", tier);
      if (status) q = q.eq("status", status);
      const match = searchFilter(query);
      if (match) q = q.or(match);
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
  }, [tier, status, query, reload]);

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
    if (next === "do_not_call") pick(row.id, false);
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

  async function assignRep(row: Row, next: string) {
    const sb = getSupabase();
    const slug = next || null;
    if (!sb || slug === row.rep_slug) return;
    setSaving(row.id);
    const { error: err } = await sb
      .from("engine_leads")
      .update({ rep_slug: slug })
      .eq("id", row.id);
    setSaving(null);
    if (err) {
      setError(`Couldn't reassign ${row.name ?? "that lead"}: ${err.message}`);
      return;
    }
    setRows((rs) => (rs ? rs.map((r) => (r.id === row.id ? { ...r, rep_slug: slug } : r)) : rs));
  }

  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : null;

  // Do-not-call leads never get a link (the server refuses them too).
  const canPick = (r: Row) => r.status !== "do_not_call";
  const pickable = (rows ?? []).filter(canPick);
  const allPicked = pickable.length > 0 && pickable.every((r) => selected.has(r.id));
  const somePicked = pickable.some((r) => selected.has(r.id));

  function pick(id: number, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function pickPage(on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const r of pickable) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  function openSend() {
    const seed = (rows ?? [])
      .filter((r) => selected.has(r.id) && canPick(r))
      .map((r) => ({
        lead_id: r.id,
        business_name: r.name ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
      }));
    if (seed.length) setSending((s) => ({ key: (s?.key ?? 0) + 1, seed }));
  }

  /** Admins only: the ticked leads as a CSV file. */
  function downloadCsv() {
    const picked = (rows ?? []).filter((r) => selected.has(r.id));
    if (!picked.length) return;
    const url = URL.createObjectURL(
      new Blob([leadsToCsv(picked, (slug) => repName(slug) ?? "")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `lamp-leads-${new Date().toISOString().slice(0, 10)}-${picked.length}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
        <label className="min-w-[14rem] flex-1 text-sm sm:max-w-sm">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-smoke">
            Search
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-smoke" />
            <input
              type="search"
              className="w-full rounded-full bg-white py-2 pl-10 pr-4 text-sm ring-1 ring-line"
              placeholder="Business, phone, email, city, industry"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-lead-search
            />
          </span>
        </label>
        <button
          type="button"
          className="rounded-full px-4 py-2 text-sm font-semibold text-smoke ring-1 ring-line hover:text-ink"
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh
        </button>
        <p className="ml-auto text-sm text-smoke">
          {isAdmin ? "Every engine lead" : "Your leads"}
          {rows && ` · ${rows.length}${rows.length === LIMIT ? "+" : ""}`}
        </p>
      </div>

      <p className="mt-3 text-xs text-smoke">
        Found by the lead engine from public records and tiered by need.{" "}
        {isAdmin
          ? "Each rep sees only the leads assigned to them."
          : "These are assigned to you; no other rep sees them."}{" "}
        Set the status after every call; it stamps the time. Nothing here dials or sends.
      </p>

      {isAdmin && <UploadLeads reps={reps} onDone={() => setReload((n) => n + 1)} />}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {sending && (
        <SendApplications
          key={sending.key}
          isAdmin={isAdmin}
          repSlug={repSlug}
          reps={reps}
          seed={sending.seed}
          onClose={() => setSending(null)}
          // reload: the server keeps a typed-in email on the lead for next time
          onSent={() => setReload((n) => n + 1)}
        />
      )}

      <div className={cn(card, "mt-4 overflow-x-auto")}>
        {rows === null ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-smoke">
            {query
              ? `Nothing matches "${query}"${tier || status ? " in this tier and status. Try All tiers and Any status." : "."}`
              : isAdmin
                ? "No engine leads here. Send leads from the Board, or upload its file, to hand some out."
                : "No leads assigned to you here yet."}
          </p>
        ) : (
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-smoke">
              <tr>
                <th className="w-10 py-3 pl-4 pr-0">
                  <input
                    type="checkbox"
                    aria-label="Select every lead on this page"
                    className="size-4 align-middle"
                    disabled={pickable.length === 0}
                    checked={allPicked}
                    ref={(el) => {
                      if (el) el.indeterminate = somePicked && !allPicked;
                    }}
                    onChange={(e) => pickPage(e.target.checked)}
                  />
                </th>
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
                  className={cn(
                    "border-b border-line last:border-0 hover:bg-sand",
                    selected.has(r.id) && "bg-sand",
                  )}
                >
                  <td className="w-10 py-3 pl-4 pr-0">
                    <input
                      type="checkbox"
                      className="size-4 align-middle disabled:opacity-40"
                      aria-label={`Select ${r.name ?? "lead"}`}
                      title={canPick(r) ? undefined : "Marked do not call"}
                      disabled={!canPick(r)}
                      checked={selected.has(r.id)}
                      onChange={(e) => pick(r.id, e.target.checked)}
                    />
                  </td>
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
                        className="underline-offset-4 hover:text-forest hover:underline"
                      >
                        {r.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                    {r.email && (
                      <div className="max-w-[12rem] truncate text-xs text-smoke">{r.email}</div>
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
                  <td className="px-4 py-3 text-smoke">
                    {isAdmin ? (
                      <select
                        className="rounded-full bg-white px-3 py-1.5 text-xs ring-1 ring-line"
                        value={r.rep_slug ?? ""}
                        disabled={saving === r.id}
                        onChange={(e) => void assignRep(r, e.target.value)}
                        aria-label={`Rep for ${r.name ?? "lead"}`}
                      >
                        <option value="">Unassigned</option>
                        {reps.map((p) => (
                          <option key={p.slug} value={p.slug}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (repName(r.rep_slug) ?? "—")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected.size > 0 && (
        <div
          className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.6)] ring-1 ring-line"
          data-lead-selection={selected.size}
        >
          <p className="text-sm font-semibold">
            {selected.size} selected
            {selected.size > MAX_RECIPIENTS && (
              <span className="ml-2 font-normal text-destructive">
                At most {MAX_RECIPIENTS} at a time
              </span>
            )}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnPrimary, "px-4 py-2")}
              disabled={selected.size > MAX_RECIPIENTS}
              onClick={openSend}
            >
              <Send className="size-4" /> Send application ({selected.size})
            </button>
            {isAdmin && (
              <button
                type="button"
                className={cn(btnOutline, "px-4 py-2")}
                onClick={downloadCsv}
                data-download-csv
              >
                <Download className="size-4" /> Download CSV ({selected.size})
              </button>
            )}
            <button
              type="button"
              className={cn(btnOutline, "px-4 py-2")}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Admin only: upload the CSV the Board downloads for Lamp. Each lead goes to the rep in the
 * file's rep_slug column, or to one rep picked here for the whole file. A lead already in Lamp
 * (same source and key) is only reassigned; what a rep has recorded on it stays.
 *
 * The Board's "send to Lamp" opens this page and hands it the same file instead (see
 * BOARD_ORIGINS): it lands here as if chosen, the admin presses Upload, and the Board hears
 * how it went so it marks the batch sent, or undoes it if nothing went in.
 */
function UploadLeads({
  reps,
  onDone,
}: {
  reps: { slug: string; name: string }[];
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [rep, setRep] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  // the Board batch waiting here, and where to tell the Board how it went
  const [board, setBoard] = useState<{ batch: number; origin: string } | null>(null);
  const parsed = text
    ? leadsFromCsv(
        text,
        reps.map((r) => r.slug),
        rep || null,
      )
    : null;

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    const receive = (e: MessageEvent) => {
      if (!(BOARD_ORIGINS as readonly string[]).includes(e.origin) || e.source !== opener) return;
      const b = boardBatch(e.data);
      if (!b) return;
      setText(b.csv);
      setFileName(b.label);
      setResult("");
      setBoard({ batch: b.batch, origin: e.origin });
      document.querySelector("[data-upload-leads]")?.scrollIntoView({ block: "center" });
    };
    window.addEventListener("message", receive);
    // only the origin that matches the opener receives this; the others are dropped
    for (const origin of BOARD_ORIGINS) {
      try {
        opener.postMessage({ type: "lamp-board:ready" }, origin);
      } catch {
        // the opener closed
      }
    }
    return () => window.removeEventListener("message", receive);
  }, []);

  function tellBoard(msg: Record<string, unknown>) {
    if (!board) return;
    try {
      (window.opener as Window | null)?.postMessage({ ...msg, batch: board.batch }, board.origin);
    } catch {
      // the Board tab closed; its batch stays as recorded
    }
  }

  async function upload() {
    const sb = getSupabase();
    if (!sb || !parsed || parsed.leads.length === 0) return;
    setBusy(true);
    setResult("");
    let done = 0;
    for (let i = 0; i < parsed.leads.length; i += 200) {
      const chunk = parsed.leads.slice(i, i + 200);
      const { error } = await sb
        .from("engine_leads")
        .upsert(chunk as TablesInsert<"engine_leads">[], { onConflict: "source,source_key" });
      if (error) {
        setBusy(false);
        setResult(`Stopped after ${done} of ${parsed.leads.length}: ${error.message}`);
        tellBoard({ type: "lamp-board:failed", count: done, error: error.message });
        if (done) onDone();
        return;
      }
      done += chunk.length;
    }
    setBusy(false);
    setResult(
      `Handed out ${done} lead${done === 1 ? "" : "s"}.` +
        (board ? " The Board has them marked sent; you can close this tab." : ""),
    );
    tellBoard({ type: "lamp-board:done", count: done });
    setBoard(null);
    setText("");
    setFileName("");
    onDone();
  }

  const perRep = parsed
    ? Object.entries(
        parsed.leads.reduce<Record<string, number>>(
          (m, l) => ({ ...m, [l.rep_slug]: (m[l.rep_slug] ?? 0) + 1 }),
          {},
        ),
      )
        .map(([slug, n]) => `${reps.find((r) => r.slug === slug)?.name ?? slug} ${n}`)
        .join(" · ")
    : "";

  return (
    <div className={cn(card, "mt-4 p-5")} data-upload-leads>
      <p className="text-sm font-semibold">Hand out leads</p>
      <p className="mt-1 text-xs text-smoke">
        On the Board, tick the leads, pick a rep and press send to Lamp: they arrive here. Or
        download the file there and choose it here.
      </p>
      {board && (
        <p
          className="mt-3 rounded-xl bg-leaf/15 px-4 py-2.5 text-sm"
          data-board-batch={board.batch}
        >
          From the Board: batch #{board.batch}. Check the rep, then press Upload to hand them out.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-line hover:ring-ink/40">
          {fileName || "Choose CSV file"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              setResult("");
              if (!f) return;
              setFileName(f.name);
              setText(await f.text());
              setBoard(null);
            }}
          />
        </label>
        <select
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line"
          value={rep}
          onChange={(e) => setRep(e.target.value)}
          aria-label="Rep for the whole file"
        >
          <option value="">Rep from the file</option>
          {reps.map((r) => (
            <option key={r.slug} value={r.slug}>
              All to {r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cn(btnPrimary, "px-4 py-2 disabled:opacity-40")}
          disabled={busy || !parsed || parsed.leads.length === 0}
          onClick={() => void upload()}
        >
          {busy
            ? "Uploading…"
            : parsed
              ? `Upload ${parsed.leads.length} lead${parsed.leads.length === 1 ? "" : "s"}`
              : "Upload"}
        </button>
        {perRep && <span className="text-xs text-smoke">{perRep}</span>}
      </div>
      {parsed && parsed.problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-destructive">
          {parsed.problems.slice(0, 8).map((p) => (
            <li key={p}>{p}</li>
          ))}
          {parsed.problems.length > 8 && <li>and {parsed.problems.length - 8} more.</li>}
        </ul>
      )}
      {result && <p className="mt-3 text-sm">{result}</p>}
    </div>
  );
}
