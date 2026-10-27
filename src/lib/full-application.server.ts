// Server side of staff reading the full application (full-application.ts in the browser). The
// database functions decide who sees what and log every full read (20261023120000_ssn_access_and_log
// and 20261027120000_application_links); since 20261027190000_server_stamp they also refuse a
// browser that calls them directly, once the switch is on.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { caller, json } from "@/lib/funder-send.server";
import { readJson } from "@/lib/application-links.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = ["reveal_ssn", "application_pdf", "funder_submission"] as const;

type Body = { application_id?: string; purpose?: (typeof PURPOSES)[number] };

/**
 * POST /api/application-details { application_id } for the masked application (SSNs cut to the
 * last four, dates of birth hidden), or with a purpose for the full numbers, which the database
 * records first. Answers { details } (null when the merchant hasn't started it), 403 { refused }
 * for anyone but an admin or the file's rep.
 */
export async function fullApplication(request: Request): Promise<Response> {
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const body = await readJson<Body>(request, 1024);
  if (body instanceof Response) return body;
  const appId = body.application_id ?? "";
  if (!UUID.test(appId)) return json(400, { error: "application_id is required." });
  if (body.purpose !== undefined && !PURPOSES.includes(body.purpose))
    return json(400, { error: "Unknown purpose." });
  const r = body.purpose
    ? await who.client.rpc("reveal_application_details", {
        _application_id: appId,
        _purpose: body.purpose,
      })
    : await who.client.rpc("staff_application_details", { _application_id: appId });
  if (r.error) {
    if (r.error.code === "42501")
      return json(403, {
        refused: true,
        error: "The full application is for admins and the assigned rep.",
      });
    return json(500, { error: "Couldn't open the full application." });
  }
  return json(200, { details: r.data ?? null });
}
