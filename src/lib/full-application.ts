import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { fromRow, type Details } from "@/lib/application-details";

/** The merchant's full application for one file, as staff see it (null when not started). */
export type FullApplication = {
  details: Details;
  signedName: string | null;
  signedAt: string | null;
};

export function useFullApplication(fileId: string, reload = 0) {
  const [full, setFull] = useState<FullApplication | null | undefined>(undefined);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("application_details")
      .select("business,owners,balances,request,signed_name,signed_at")
      .eq("application_id", fileId)
      .maybeSingle()
      .then(({ data }) => {
        const r = data as {
          business: unknown;
          owners: unknown;
          balances: unknown;
          request: unknown;
          signed_name: string | null;
          signed_at: string | null;
        } | null;
        setFull(
          r ? { details: fromRow(r), signedName: r.signed_name, signedAt: r.signed_at } : null,
        );
      });
  }, [fileId, reload]);
  return full;
}
