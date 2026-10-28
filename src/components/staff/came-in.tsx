import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { stamp } from "@/lib/staff";

/**
 * How a file came in, so nobody wonders whose deal it is: the personal link a rep sent (who
 * sent it, when it went out, was opened, started and signed), a rep's public link (step by
 * step or the one-page form), or the website. Reads what the database already keeps on the
 * file (invite_id, source_rep_slug, utm) and on the link (application_invites).
 */

type Source = {
  invite_id: string | null;
  source_rep_slug: string | null;
  utm: Record<string, unknown> | null;
  created_at: string;
};

type Invite = {
  rep_slug: string;
  sent_by: string | null;
  channel: string;
  sent_at: string;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
};

/** "Zeus (Stevie's team)" for a slug. */
function teamName(reps: TeamRep[], slug: string | null): string {
  if (!slug) return "Unassigned";
  const r = reps.find((x) => x.slug === slug);
  const lead = r?.admin_slug ? reps.find((x) => x.slug === r.admin_slug)?.name : null;
  return `${r?.name ?? slug}${lead ? ` (${lead.split(" ")[0]}'s team)` : ""}`;
}

type TeamRep = { slug: string; name: string; admin_slug?: string | null };

export function CameIn({ fileId, reps }: { fileId: string; reps: TeamRep[] }) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    const repName = (slug: string | null) => teamName(reps, slug);
    (async () => {
      const a = await sb
        .from("applications")
        .select("invite_id,source_rep_slug,utm,created_at")
        .eq("id", fileId)
        .maybeSingle();
      const src = a.data as Source | null;
      if (!src || !live) return;
      const utm = src.utm ?? {};
      if (src.invite_id) {
        const i = await sb
          .from("application_invites")
          .select("rep_slug,sent_by,channel,sent_at,opened_at,started_at,submitted_at")
          .eq("id", src.invite_id)
          .maybeSingle();
        const inv = i.data as Invite | null;
        if (!inv || !live) return;
        let sender: string | null = null;
        if (inv.sent_by) {
          const s = await sb
            .from("reps")
            .select("slug,name")
            .eq("user_id", inv.sent_by)
            .maybeSingle();
          const r = s.data as { slug: string; name: string } | null;
          if (r && r.slug !== inv.rep_slug) sender = r.name;
        }
        const steps = [
          `${inv.channel === "email" ? "emailed" : "link copied"} ${stamp(inv.sent_at)}`,
          inv.opened_at && `opened ${stamp(inv.opened_at)}`,
          inv.started_at && `started ${stamp(inv.started_at)}`,
          inv.submitted_at && `signed ${stamp(inv.submitted_at)}`,
        ].filter(Boolean);
        if (live)
          setLine(
            `Personal link from ${repName(inv.rep_slug)}${sender ? `, sent by ${sender}` : ""}: ${steps.join(" · ")}`,
          );
        return;
      }
      if (utm["source"] === "application_link") {
        const form =
          utm["form"] === "pdf" ? "the one-page form (B)" : "the step-by-step application (A)";
        setLine(
          `${repName(src.source_rep_slug)}'s public link, ${form} · signed ${stamp(src.created_at)}`,
        );
        return;
      }
      const ref = typeof utm["ref"] === "string" ? utm["ref"] : null;
      setLine(
        `The website's quick application${ref ? `, from ${repName(ref)}'s link` : ""} · ${stamp(src.created_at)}`,
      );
    })();
    return () => {
      live = false;
    };
  }, [fileId, reps]);

  if (!line) return null;
  return (
    <p className="mt-1 text-sm text-smoke" data-came-in>
      <span className="font-semibold text-ink">How it came in:</span> {line}
    </p>
  );
}
