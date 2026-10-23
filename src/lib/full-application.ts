import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { fromRow, type Details } from "@/lib/application-details";

/** The merchant's full application for one file, as staff see it (null when not started). */
export type FullApplication = {
  details: Details;
  signedName: string | null;
  signedAt: string | null;
};

/** Staff who are neither an admin nor the file's rep get this instead of the application. */
export const RESTRICTED = "restricted" as const;

type Row = {
  business: unknown;
  owners: unknown;
  balances: unknown;
  request: unknown;
  signed_name: string | null;
  signed_at: string | null;
} | null;

type RpcError = { code?: string; message?: string } | null;

const toFull = (r: Row): FullApplication | null =>
  r ? { details: fromRow(r), signedName: r.signed_name, signedAt: r.signed_at } : null;

// PGRST202: the function is not in the database yet (code published before the SQL ran).
const notDeployed = (e: RpcError) => e?.code === "PGRST202";
const refused = (e: RpcError) => e?.code === "42501";

async function readTable(fileId: string): Promise<Row> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("application_details")
    .select("business,owners,balances,request,signed_name,signed_at")
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
