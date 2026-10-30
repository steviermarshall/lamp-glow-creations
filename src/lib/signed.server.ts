// GET /api/staff/signed: when each file the caller can see was signed, for the Dashboard's
// "signed" counts. Never import this from browser code: the route file loads it inside its
// handler.
//
// Staff can't read application_details from their own client (it holds SSNs), so the files are
// read as the caller (the database's rules decide which they see) and Lamp's server reads only
// the signing time for those, through signedAt in brain.server.ts.

import { caller, json, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { signedAt, staff } from "@/lib/brain.server";

const PAGE = 1000;
const MAX_PAGES = 50;

export async function signedFiles(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  if (!(await staff(who.userId))) return json(403, { error: "This is for Lamp staff." });

  const ids: string[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await who.client
      .from("pipeline_board")
      .select("id")
      .order("created_at")
      .range(i * PAGE, i * PAGE + PAGE - 1);
    if (r.error) return json(500, { error: "Couldn't read your files." });
    const rows = (r.data ?? []) as { id: string }[];
    ids.push(...rows.map((x) => String(x.id)));
    if (rows.length < PAGE) break;
  }
  return json(200, { signed: await signedAt(ids) });
}
