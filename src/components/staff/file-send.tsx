import { useCallback, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { btnPrimary, card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import { applicationPdfBytes } from "@/lib/application-pdf";
import { detailsToPdf } from "@/lib/application-details";
import { revealFullApplication } from "@/lib/full-application";
import type { Answers } from "@/lib/apply";

/**
 * Send this file to its matched funders, from the partners@ mailbox, in one click.
 *
 * The database decides who matches (funder_matches: each funder's criteria against the file)
 * and who may send (admins and the file's rep). The signed application is built here, through
 * reveal_application_details('funder_submission'), which logs the access, and goes out with the
 * bank statements. Each funder gets its own email. Nothing sends without the confirm.
 */

type Match = {
  funder_id: string;
  funder_name: string;
  submission_email: string | null;
  auto_send: boolean;
  already_sent: boolean;
  eligible: boolean;
  blockers: string[] | null;
  checks: string[] | null;
};

type Result = { funder_id: string; funder: string; status: string; detail: string };

type Doc = { kind: string | null; status: string | null };

export type SendFile = {
  answers: Answers | null;
  first_name: string | null;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  amount_requested: number | null;
};

const toBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

async function errorText(e: unknown): Promise<string> {
  const ctx = (e as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* fall through */
    }
  }
  return e instanceof Error ? e.message : "Couldn't reach the sending service.";
}

export function FileSend({
  fileId,
  file,
  repName,
  signedAt,
  hold = null,
  onSent,
}: {
  fileId: string;
  file: SendFile;
  repName: string | null;
  signedAt: string | null;
  /** Why it can't go out right now ("Send back for changes"), or null. */
  hold?: string | null;
  onSent: () => void;
}) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [mailbox, setMailbox] = useState<{ mailbox: string; connected_at: string } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [m, mb, d] = await Promise.all([
      sb.rpc("funder_matches", { _application_id: fileId }),
      sb.rpc("mailer_status"),
      sb.from("documents").select("kind,status").eq("application_id", fileId),
    ]);
    if (m.error) {
      setError(
        m.error.code === "PGRST202"
          ? "Sending to funders isn't switched on in the database yet."
          : "Couldn't match funders. Refresh to try again.",
      );
      setMatches([]);
      return;
    }
    const rows = (m.data ?? []) as Match[];
    setMatches(rows);
    setPicked(
      new Set(
        rows
          .filter((r) => r.eligible && !r.already_sent && r.submission_email)
          .map((r) => r.funder_id),
      ),
    );
    setMailbox(((mb.data ?? []) as { mailbox: string; connected_at: string }[])[0] ?? null);
    setDocs((d.data ?? []) as Doc[]);
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = (kind: string) =>
    docs.filter((d) => d.kind === kind && (d.status === "received" || d.status === "accepted"))
      .length;
  const statements = counts("bank_statement");
  const uploadedApp = counts("funder_application") > 0;
  const hasApplication = !!signedAt || uploadedApp;
  const packageReady = hasApplication && statements >= 3 && !hold;
  const chosen = (matches ?? []).filter((m) => picked.has(m.funder_id));

  async function run(dryRun: boolean) {
    const sb = getSupabase();
    if (!sb || chosen.length === 0) return;
    if (!dryRun) {
      const list = chosen.map((m) => `${m.funder_name} (${m.submission_email})`).join("\n");
      const ok = window.confirm(
        `Email this file to ${chosen.length} funder${chosen.length === 1 ? "" : "s"} from ${mailbox?.mailbox ?? "the Lamp mailbox"}?\n\n${list}\n\nEach gets the signed application, SSN included, and the bank statements.`,
      );
      if (!ok) return;
    }
    setBusy(dryRun ? "preview" : "send");
    setError("");
    setResults(null);
    try {
      let application_pdf: string | undefined;
      if (signedAt && !dryRun) {
        const full = await revealFullApplication(fileId, "funder_submission");
        if (full) {
          const bytes = await applicationPdfBytes(
            { ...file, repName },
            detailsToPdf(
              full.details,
              {
                name: full.signedName,
                at: full.signedAt,
                image: full.signatureImage,
                name2: full.signedName2,
                image2: full.signatureImage2,
                via: full.signedVia,
                ip: full.signerIp,
                agent: full.signerAgent,
                consent: full.consentVersion,
                version: full.version,
                replaces: full.replaces,
              },
              repName,
            ),
          );
          application_pdf = toBase64(bytes);
        }
      }
      const session = (await sb.auth.getSession()).data.session;
      if (!session) throw new Error("Sign in again to send.");
      const res = await fetch("/api/funders/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          application_id: fileId,
          funder_ids: chosen.map((m) => m.funder_id),
          application_pdf,
          dry_run: dryRun,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
      if (!res.ok) throw new Error(data.error || `The sending service answered ${res.status}.`);
      setResults(data.results ?? []);
      if (!dryRun) {
        await load();
        onSent();
      }
    } catch (e) {
      setError(await errorText(e));
    } finally {
      setBusy("");
    }
  }

  if (matches === null) {
    return (
      <section className={cn(card, "p-6")} data-file-send="loading">
        <Loader2 className="size-5 animate-spin text-smoke" />
      </section>
    );
  }

  // Sendable funders first, then the ones that don't match, each in name order.
  const sendable = (m: Match) => m.eligible && !!m.submission_email;
  const open = matches
    .filter((m) => !m.already_sent)
    .sort(
      (a, b) =>
        Number(sendable(b)) - Number(sendable(a)) || a.funder_name.localeCompare(b.funder_name),
    );
  const sent = matches.filter((m) => m.already_sent);

  return (
    <section className={cn(card, "p-6")} data-file-send>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">Send to funders</h3>
        <p className="text-sm text-smoke">
          {mailbox
            ? `From ${mailbox.mailbox}`
            : "No sending mailbox yet: an admin connects it on the Funders page."}
        </p>
      </div>

      <ul className="mt-3 space-y-1 text-sm" data-package>
        {hold && (
          <li className="font-semibold text-destructive" data-hold>
            {hold}
          </li>
        )}
        <li className={hasApplication ? "" : "text-destructive"}>
          Signed application:{" "}
          {signedAt
            ? `e-signed ${stamp(signedAt)}`
            : uploadedApp
              ? "uploaded by the merchant"
              : "not signed yet"}
        </li>
        <li className={statements >= 3 ? "" : "text-destructive"}>
          Bank statements: {statements >= 3 ? `${statements} on file` : `${statements} of 3 needed`}
        </li>
        {(counts("voided_check") > 0 || counts("drivers_license") > 0) && (
          <li className="text-smoke">
            Also attached:{" "}
            {[
              counts("voided_check") > 0 && "voided check",
              counts("drivers_license") > 0 && "driver's license",
            ]
              .filter(Boolean)
              .join(", ")}
          </li>
        )}
      </ul>

      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-smoke">
          No active funders yet. An admin adds them on the Funders page.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {open.map((m) => {
            const can = m.eligible && !!m.submission_email;
            return (
              <li
                key={m.funder_id}
                className={cn("rounded-xl bg-sand px-4 py-3 text-sm", !can && "opacity-70")}
                data-match={m.funder_name}
                data-eligible={can ? "yes" : "no"}
              >
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input
                    type="checkbox"
                    disabled={!can || !!busy}
                    checked={picked.has(m.funder_id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(m.funder_id);
                        else next.delete(m.funder_id);
                        return next;
                      })
                    }
                  />
                  <span className="font-semibold">{m.funder_name}</span>
                  {m.submission_email && <span className="text-smoke">{m.submission_email}</span>}
                  {m.auto_send && <span className={chip}>sends automatically</span>}
                </label>
                {(m.blockers ?? []).length > 0 && (
                  <p className="mt-1 text-destructive">
                    Not a match: {(m.blockers ?? []).join("; ")}
                  </p>
                )}
                {can && (m.checks ?? []).length > 0 && (
                  <p className="mt-1 text-smoke">Check first: {(m.checks ?? []).join("; ")}</p>
                )}
              </li>
            );
          })}
          {sent.length > 0 && (
            <li className="px-1 text-sm text-smoke">
              Already sent to {sent.map((m) => m.funder_name).join(", ")}.
            </li>
          )}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {results && (
        <ul className="mt-3 space-y-1 text-sm" data-send-results>
          {results.map((r) => (
            <li key={r.funder_id} data-result={r.status}>
              <span className="font-semibold">{r.funder}</span>:{" "}
              {r.status === "sent"
                ? `sent to ${r.detail}`
                : r.status === "would_send"
                  ? `would send to ${r.detail}`
                  : r.status === "failed"
                    ? `failed (${r.detail}), nothing recorded`
                    : `skipped, ${r.detail}`}
            </li>
          ))}
        </ul>
      )}

      {matches.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={chip}
            disabled={!!busy || chosen.length === 0 || !packageReady}
            onClick={() => void run(true)}
          >
            {busy === "preview" ? "Checking…" : "Preview"}
          </button>
          <button
            type="button"
            className={cn(btnPrimary, "px-4 py-2.5")}
            disabled={!!busy || chosen.length === 0 || !packageReady || !mailbox}
            onClick={() => void run(false)}
          >
            {busy === "send" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send to {chosen.length} funder{chosen.length === 1 ? "" : "s"}
          </button>
          {!packageReady && !hold && (
            <span className="text-sm text-smoke">
              Needs the signed application and 3 statements first.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
