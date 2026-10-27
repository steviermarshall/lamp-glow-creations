import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { postAsMe } from "@/lib/server-api";
import { fromRow, type Details } from "@/lib/application-details";
import type { StaffVersions } from "@/lib/application-changes";

/** The merchant's full application for one file, as staff see it (null when not started). */
export type FullApplication = {
  details: Details;
  signedName: string | null;
  signedAt: string | null;
  /** The second owner's typed name, when they signed too. */
  signedName2: string | null;
  /** Drawn signatures (PNG data URLs); null for applications signed before drawing existed. */
  signatureImage: string | null;
  signatureImage2: string | null;
  /** "link": signed from an application link with no account; "account": from /account. */
  signedVia: "link" | "account" | null;
  signerIp: string | null;
  signerAgent: string | null;
  /** The authorization wording they agreed to (CONSENT_VERSION at the time). */
  consentVersion: string | null;
  /** Which signed version this is (2 and up after "Send back for changes"), when recorded. */
  version: number | null;
  /** When the version it replaced was signed (ISO). */
  replaces: string | null;
};

/** Staff who are neither an admin nor the file's rep get this instead of the application. */
export const RESTRICTED = "restricted" as const;

type Row = {
  business: unknown;
  owners: unknown;
  balances: unknown;
  request: unknown;
  real_estate?: unknown;
  signed_name: string | null;
  signed_at: string | null;
  signed_name_2?: string | null;
  signature_image?: string | null;
  signature_image_2?: string | null;
  signed_via?: string | null;
  signer_ip?: string | null;
  signer_agent?: string | null;
  consent_version?: string | null;
  version?: number | null;
  replaces?: string | null;
} | null;

const toFull = (r: Row): FullApplication | null =>
  r
    ? {
        details: fromRow(r),
        signedName: r.signed_name,
        signedAt: r.signed_at,
        signedName2: r.signed_name_2 ?? null,
        signatureImage: r.signature_image ?? null,
        signatureImage2: r.signature_image_2 ?? null,
        signedVia: r.signed_via === "link" || r.signed_via === "account" ? r.signed_via : null,
        signerIp: r.signer_ip ?? null,
        signerAgent: r.signer_agent ?? null,
        consentVersion: r.consent_version ?? null,
        version: typeof r.version === "number" ? r.version : null,
        replaces: r.replaces ?? null,
      }
    : null;

/** One read through the site's server, which asks the database as the signed-in staff member. */
const ask = (fileId: string, purpose?: string) =>
  postAsMe<{ details: Row; refused: boolean }>("/api/application-details", {
    application_id: fileId,
    ...(purpose ? { purpose } : {}),
  });

/** The full application with SSNs cut to the last four and dates of birth hidden. */
export function useFullApplication(fileId: string, reload = 0) {
  const [full, setFull] = useState<FullApplication | typeof RESTRICTED | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!getSupabase()) return;
    let live = true;
    (async () => {
      let next: FullApplication | typeof RESTRICTED | null;
      try {
        const r = await ask(fileId);
        next = r.data.refused ? RESTRICTED : toFull(r.ok ? (r.data.details ?? null) : null);
      } catch {
        next = null;
      }
      if (live) setFull(next);
    })();
    return () => {
      live = false;
    };
  }, [fileId, reload]);
  return full;
}

/** Every signed version of a file and every change request, for staff (masked). */
export function useVersions(fileId: string, reload = 0) {
  const [out, setOut] = useState<StaffVersions | typeof RESTRICTED | null | undefined>(undefined);
  useEffect(() => {
    if (!getSupabase()) return;
    let live = true;
    (async () => {
      let next: StaffVersions | typeof RESTRICTED | null;
      try {
        const r = await postAsMe<{ versions: StaffVersions | null; refused: boolean }>(
          "/api/application-details",
          { application_id: fileId, versions: true },
        );
        // not in the database yet, or a hiccup: the file screen works without it
        next = r.data.refused ? RESTRICTED : r.ok ? (r.data.versions ?? null) : null;
      } catch {
        next = null;
      }
      if (live) setOut(next);
    })();
    return () => {
      live = false;
    };
  }, [fileId, reload]);
  return out;
}

/** One version with the full SSNs, for that version's PDF. Logged by the database first. */
export async function revealVersion(
  fileId: string,
  version: number,
): Promise<FullApplication | null> {
  if (!getSupabase()) return null;
  const r = await postAsMe<{ details: (Row & { version: number }) | null }>(
    "/api/application-details",
    { application_id: fileId, version },
  );
  if (!r.ok) throw new Error(r.data.error || "Couldn't open that version.");
  const row = r.data.details ?? null;
  if (!row) return null;
  const full = toFull(row);
  return full && { ...full, version: row.version };
}

/**
 * The full numbers, for Show SSN or the application PDF. The database records who asked, for
 * which file and why before it answers, and refuses anyone but an admin or the file's rep.
 */
export async function revealFullApplication(
  fileId: string,
  purpose: "reveal_ssn" | "application_pdf" | "funder_submission",
): Promise<FullApplication | null> {
  if (!getSupabase()) return null;
  const r = await ask(fileId, purpose);
  if (!r.ok) throw new Error(r.data.error || "Couldn't open the full application.");
  return toFull(r.data.details ?? null);
}
