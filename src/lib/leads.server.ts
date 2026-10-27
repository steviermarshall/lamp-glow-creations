// Server side of the public lead form (recordLead in use-auth.ts). The browser used to write the
// lead itself, with any fields and as often as it liked (security baseline L-005). Now:
//   * only email, first name, phone, answers and utm reach the database, which also allows only
//     those columns; the rep comes from the ref link in utm, through leads_before_insert;
//   * one network sends at most 10 leads an hour (lead_intake_allowed, the service role only);
//   * the insert carries the server's stamp, which the leads table requires once the switch in
//     20261027190000_server_stamp.sql is on.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { json, service, SERVICE_KEY, SUPABASE_URL, visitor } from "@/lib/funder-send.server";
import { clientIp, readJson } from "@/lib/application-links.server";
import { EMAIL_RE } from "@/lib/application-links";

const MAX_LEAD_BYTES = 16 * 1024;

type Body = {
  email?: unknown;
  first_name?: unknown;
  phone?: unknown;
  answers?: unknown;
  utm?: unknown;
};

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** utm and ref values are short strings; anything else is dropped. */
function cleanUtm(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v).slice(0, 20)) {
    if (/^[\w-]{1,40}$/.test(k) && typeof x === "string") out[k] = x.slice(0, 200);
  }
  return out;
}

/** POST /api/leads: the lead form's email step. Answers { ok }, or 429 when one network sends too many. */
export async function submitLead(request: Request): Promise<Response> {
  if (!SUPABASE_URL()) return json(500, { error: "The server is missing its database settings." });
  const body = await readJson<Body>(request, MAX_LEAD_BYTES);
  if (body instanceof Response) return body;
  const email = text(body.email, 200)?.toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email." });

  if (SERVICE_KEY()) {
    const allowed = await service().rpc(
      "lead_intake_allowed" as never,
      { _ip: clientIp(request) } as never,
    );
    // before the migration runs the limit isn't there yet; the lead still counts
    if (!allowed.error && allowed.data === false)
      return json(429, { error: "Too many tries from this network. Try again in an hour." });
  }

  const r = await visitor()
    .from("leads")
    .insert({
      email,
      first_name: text(body.first_name, 80),
      phone: text(body.phone, 40),
      answers: (isObject(body.answers) ? body.answers : {}) as never,
      utm: cleanUtm(body.utm) as never,
    });
  if (r.error) return json(500, { error: "Couldn't save that. Try again." });
  return json(200, { ok: true });
}
