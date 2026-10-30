import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age, stamp } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { tel } from "@/lib/engine-leads";
import { isStage, STAGE_INFO, type Stage } from "@/lib/application-progress";

/**
 * Started, not signed: people who gave their name and number on a rep's public link (online or
 * the one-page form) in the last 30 days and haven't signed. Each shows how far they got and what
 * to cover on the call. The database shows a rep only their own leads and an admin everyone's.
 */

type Lead = {
  id: string;
  created_at: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  rep_slug: string | null;
  answers: Record<string, unknown> | null;
};

type Progress = { stage?: unknown; at?: unknown; form?: unknown };

const DAYS = 30;

export function StartedLeads({
  isAdmin,
  rep,
  reps,
}: {
  isAdmin: boolean;
  /** An admin's rep filter; "" for everyone. */
  rep: string;
  reps: { slug: string; name: string }[];
}) {
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    let q = sb
      .from("leads")
      .select("id,created_at,first_name,email,phone,rep_slug,answers")
      .eq("answers->>source", "application_link")
      .is("converted_application_id", null)
      .gte("created_at", new Date(Date.now() - DAYS * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    if (isAdmin && rep) q = q.eq("rep_slug", rep);
    const { data, error: err } = await q;
    if (err) {
      setError("Couldn't load who started. Refresh to try again.");
      setRows([]);
      return;
    }
    setError("");
    setRows((data ?? []) as unknown as Lead[]);
  }, [isAdmin, rep]);

  useEffect(() => {
    void load();
  }, [load]);

  const repName = (slug: string | null) => reps.find((r) => r.slug === slug)?.name ?? slug ?? "—";

  return (
    <section className={cn(card, "mt-4 p-5")} data-started-leads>
      <p className="text-sm font-semibold">Started, not signed</p>
      <p className="mt-1 text-xs text-smoke">
        People who gave their name and number on {isAdmin ? "a rep's" : "your"} public link in the
        last {DAYS} days and haven't signed, with how far they got and what to cover when you call.
      </p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {rows === null ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="size-5 animate-spin text-smoke" />
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-smoke">Nobody waiting.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => {
            const a = r.answers ?? {};
            const p = (a["progress"] ?? {}) as Progress;
            const stage: Stage = isStage(p.stage) ? p.stage : "contact";
            const form = (p.form ?? a["form"]) === "pdf" ? "B · one-page form" : "A · online";
            const last = typeof a["lastName"] === "string" ? a["lastName"] : "";
            const at = typeof p.at === "string" ? p.at : r.created_at;
            return (
              <li key={r.id} className="py-3" data-started-stage={stage}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    to="/staff"
                    search={{ lead: r.id }}
                    className="font-semibold underline-offset-4 hover:underline"
                    title="Open their profile: what they gave, how far they got, notes & calls"
                  >
                    {[r.first_name, last].filter(Boolean).join(" ") || "No name"}
                  </Link>
                  {r.phone && (
                    <a className="text-sm text-forest underline" href={`tel:${tel(r.phone)}`}>
                      {r.phone}
                    </a>
                  )}
                  {r.email && (
                    <a className="text-sm text-smoke underline" href={`mailto:${r.email}`}>
                      {r.email}
                    </a>
                  )}
                  <span className="ml-auto text-xs text-smoke" title={stamp(at)}>
                    {form} · last active {age(at)} ago
                    {isAdmin && ` · ${repName(r.rep_slug)}`}
                  </span>
                </div>
                <p className="mt-1 text-sm">{STAGE_INFO[stage].label}</p>
                <p className="mt-0.5 text-xs text-smoke">On the call: {STAGE_INFO[stage].call}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
