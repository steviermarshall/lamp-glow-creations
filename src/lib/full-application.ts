import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { fromRow, type Details } from "@/lib/application-details";

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
} | null;

type RpcError = { code?: string; message?: string } | null;

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
      }
    : null;

// PGRST202: the function is not in the database yet (code published before the SQL ran).
const notDeployed = (e: RpcError) => e?.code === "PGRST202";
const refused = (e: RpcError) => e?.code === "42501";

async function readTable(fileId: string): Promise<Row> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("application_details")
    .select(
      "business,owners,balances,request,real_estate,signed_name,signed_at,signed_name_2,signature_image,signature_image_2,signed_via,signer_ip,signer_agent,consent_version",
    )
    .eq("application_id", fileId)
    .maybeSingle();
  return data as Row;
}

/** The full application with SSNs cut to the last four and dates of birth hidden. */
export function useFullApplication(fileId: string, reload = 0) {
  const [full, setFull] = useState<FullApplication | typeof RESTRICTED | null | undefined>(
    undefined,
  );
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const { data, error } = await sb.rpc("staff_application_details", {
        _application_id: fileId,
      });
      let next: FullApplication | typeof RESTRICTED | null;
      if (refused(error)) next = RESTRICTED;
      else if (notDeployed(error)) next = toFull(await readTable(fileId));
      else next = toFull(data as unknown as Row);
      if (live) setFull(next);
    })();
    return () => {
      live = false;
    };
  }, [fileId, reload]);
  return full;
}

/**
 * The full numbers, for Show SSN or the application PDF. The database records who asked, for
 * which file and why before it answers, and refuses anyone but an admin or the file's rep.
 */
export async function revealFullApplication(
  fileId: string,
  purpose: "reveal_ssn" | "application_pdf" | "funder_submission",
): Promise<FullApplication | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("reveal_application_details", {
    _application_id: fileId,
    _purpose: purpose,
  });
  if (notDeployed(error)) return toFull(await readTable(fileId));
  if (error) throw new Error(error.message || "Couldn't open the full application.");
  return toFull(data as unknown as Row);
}
