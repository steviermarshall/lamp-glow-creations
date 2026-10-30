import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Loader2, Mail, Phone } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age, stamp } from "@/lib/staff";
import { card } from "@/components/site/layout";
import { tel } from "@/lib/engine-leads";
import { isStage, STAGE_INFO, STAGES, type Stage } from "@/lib/application-progress";
import { NotesCalls } from "@/components/staff/notes-calls";

/**
 * A lead's profile (staff only): someone who gave their name, phone and email on a rep's link or the
 * website but hasn't filed. What they gave, where they came in, how far they got and what to say on
 * the call, and the same notes & calls thread as a file. When they file with the same email the lead
 * is marked converted and its notes carry onto the file (20261029150000_lead_profiles_notes.sql).
 * The database shows a rep only their own and untagged leads; the merchant never sees any of this.
 */

type LeadRow = {
  id: string;
  created_at: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  rep_slug: string | null;
  source: string | null;
  answers: Record<string, unknown> | null;
  utm: Record<string, unknown> | null;
  converted_application_id: string | null;
  converted_at: string | null;
};

type Progress = { stage?: unknown; at?: unknown; form?: unknown };

export function LeadProfile({
  leadId,
  isAdmin,
  repSlug,
  reps,
}: {
  leadId: string;
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [lead, setLead] = useState<LeadRow | null | undefined>(undefined);
  const [file, setFile] = useState<{ business_name: string | null; status: string } | null>(null);
  const [notesOff, setNotesOff] = useState(false);
  const noNotes = useCallback(() => setNotesOff(true), []);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("leads")
      .select(
        "id,created_at,first_name,email,phone,rep_slug,source,answers,utm,converted_application_id,converted_at",
      )
      .eq("id", leadId)
      .maybeSingle();
    const row = (data ?? null) as unknown as LeadRow | null;
    setLead(row);
    if (row?.converted_application_id) {
      const f = await sb
        .from("applications")
        .select("business_name,status")
        .eq("id", row.converted_application_id)
        .maybeSingle();
      setFile((f.data ?? null) as { business_name: string | null; status: string } | null);
    } else setFile(null);
  }, [leadId]);

  useEffect(() => {
    setLead(undefined);
    void load();
  }, [load]);

  if (lead === undefined)
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-smoke" />
      </div>
    );
  if (lead === null)
    return (
      <div className="mt-8">
        <Back />
        <p className="mt-6 text-sm text-smoke">
          That lead isn&apos;t here, or it belongs to another rep.
        </p>
      </div>
    );

  const a = lead.answers ?? {};
  const p = (a["progress"] ?? {}) as Progress;
  const fromLink = a["source"] === "application_link";
  const stage: Stage | null = isStage(p.stage) ? p.stage : fromLink ? "contact" : null;
  const reached = stage ? STAGES.indexOf(stage) : -1;
  const form = (p.form ?? a["form"]) === "pdf" ? "B · one-page form" : "A · online";
  const last = typeof a["lastName"] === "string" ? a["lastName"] : "";
  const name = [lead.first_name, last].filter(Boolean).join(" ") || "No name";
  const lastActive = typeof p.at === "string" ? p.at : lead.created_at;
  const consent = typeof a["phoneConsent"] === "string" ? a["phoneConsent"] : "";
  const repName = (slug: string | null) =>
    slug ? (reps.find((r) => r.slug === slug)?.name ?? slug) : "Unassigned";
  const utm = Object.entries(lead.utm ?? {}).filter(([k]) => k.startsWith("utm_"));

  return (
    <div className="mt-6" data-lead-profile={lead.id}>
      <Back />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold">{name}</h2>
        {lead.converted_application_id ? (
          <span className="rounded-full bg-leaf/20 px-3 py-1 text-xs font-semibold text-forest">
            Signed · became a file
          </span>
        ) : fromLink ? (
          <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold">
            Started, not signed
          </span>
        ) : (
          <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold">Website lead</span>
        )}
        <span className="text-sm text-smoke">
          {repName(lead.rep_slug)} · came in {age(lead.created_at)} ago
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={cn(card, "p-6")}>
          {lead.converted_application_id && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-leaf/10 px-4 py-3 text-sm">
              <span>
                Signed {lead.converted_at ? `${age(lead.converted_at)} ago` : ""}
                {file?.business_name ? ` as ${file.business_name}` : ""}. Its notes carried over to
                the file.
              </span>
              <Link
                to="/staff"
                search={{ file: lead.converted_application_id }}
                className="ml-auto inline-flex items-center gap-1 font-semibold text-forest hover:underline"
              >
                Open the file <ExternalLink className="size-3.5" />
              </Link>
            </div>
          )}
          <h3 className="font-display text-lg font-semibold">Where they stand</h3>
          {stage ? (
            <>
              <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="How far they got">
                {STAGES.map((s, i) => (
                  <li
                    key={s}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs capitalize ring-1",
                      i < reached
                        ? "bg-leaf/20 text-forest ring-leaf/40"
                        : i === reached
                          ? "bg-ink text-white ring-ink"
                          : "text-smoke ring-line",
                    )}
                  >
                    {s}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-sm font-semibold">{STAGE_INFO[stage].label}</p>
              <p className="mt-1 text-sm text-smoke">On the call: {STAGE_INFO[stage].call}</p>
              <p className="mt-2 text-xs text-smoke" title={stamp(lastActive)}>
                Link {form} · last active {age(lastActive)} ago
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-smoke">
              Came in from the website&apos;s quick form. Call to learn what the money is for.
            </p>
          )}

          {notesOff ? (
            <p className="mt-6 text-sm text-smoke">
              Notes on leads start once the database update runs.
            </p>
          ) : (
            <NotesCalls
              leadId={lead.id}
              isAdmin={isAdmin}
              repSlug={repSlug}
              reps={reps}
              fileRep={lead.rep_slug}
              onUnavailable={noNotes}
              onFileChanged={() => void load()}
            />
          )}
        </section>

        <aside className="space-y-4">
          <section className={cn(card, "p-6 text-sm")}>
            <h3 className="font-display text-lg font-semibold">Contact</h3>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-xs text-smoke">Phone</dt>
                <dd>
                  {lead.phone ? (
                    <a
                      href={`tel:${tel(lead.phone)}`}
                      className="inline-flex items-center gap-1.5 text-forest underline"
                    >
                      <Phone className="size-3.5" /> {lead.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-smoke">Email</dt>
                <dd>
                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="inline-flex items-center gap-1.5 break-all underline"
                    >
                      <Mail className="size-3.5" /> {lead.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-smoke">Calls &amp; texts</dt>
                <dd>{consent ? `Agreed ${stamp(consent.split(" | ")[0])}` : "Not given"}</dd>
              </div>
            </dl>
          </section>
          <section className={cn(card, "p-6 text-sm")}>
            <h3 className="font-display text-lg font-semibold">How they came in</h3>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-xs text-smoke">Through</dt>
                <dd>{fromLink ? `${repName(lead.rep_slug)}'s link (${form})` : "The website"}</dd>
              </div>
              <div>
                <dt className="text-xs text-smoke">First seen</dt>
                <dd>{stamp(lead.created_at)}</dd>
              </div>
              {utm.length > 0 && (
                <div>
                  <dt className="text-xs text-smoke">Campaign</dt>
                  <dd className="break-words">
                    {utm.map(([k, v]) => `${k.replace("utm_", "")}: ${String(v)}`).join(" · ")}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Back() {
  return (
    <Link
      to="/staff"
      search={{ view: "sent" }}
      className="inline-flex items-center gap-1.5 text-sm text-smoke hover:text-ink"
    >
      <ArrowLeft className="size-4" /> Applications
    </Link>
  );
}
