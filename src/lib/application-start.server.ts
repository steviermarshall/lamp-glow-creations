// Server side of the application link's first screen (POST /api/application/start): someone on a
// rep's public link gives their name, phone and email before the long form. That's saved at once
// as a lead with the rep (utm.ref, through leads_before_insert), and the rep is emailed, with Asad
// and Stevie copied, so they can call while the person is still on the page. Once per email and
// rep a day, and within the lead form's per-network limit. Never import this from browser code.
import {
  gmailAccessToken,
  GMAIL_SEND_URL,
  json,
  MAILBOX,
  service,
  SUPABASE_URL,
  visitor,
} from "@/lib/funder-send.server";
import { b64url, buildMime } from "@/lib/funder-send";
import { clientIp, readJson } from "@/lib/application-links.server";
import { EMAIL_RE, fromName } from "@/lib/application-links";
import { NEW_APPLICATION_COPY } from "@/lib/site";
import { recipients, startedEmail } from "@/lib/new-application-email";

const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const DAY_MS = 86_400_000;

type Body = {
  rep?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  email?: unknown;
  phone_consent?: unknown;
  utm?: unknown;
};

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "";

export async function startApplication(request: Request): Promise<Response> {
  if (!SUPABASE_URL()) return json(500, { error: "The server is missing its database settings." });
  const body = await readJson<Body>(request, 8 * 1024);
  if (body instanceof Response) return body;
  const rep = text(body.rep, 32).toLowerCase();
  const first = text(body.first_name, 80);
  const last = text(body.last_name, 80);
  const email = text(body.email, 200).toLowerCase();
  const phone = text(body.phone, 40);
  const digits = phone.replace(/\D/g, "");
  const consent = text(body.phone_consent, 600);
  if (!SLUG.test(rep)) return json(400, { error: "That link isn't right." });
  if (!first || !last) return json(400, { error: "Add your first and last name." });
  if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email." });
  if (digits.length < 10 || digits.length > 11)
    return json(400, { error: "Enter a 10-digit phone number." });

  const svc = service();
  const repRow = await svc
    .from("reps")
    .select("slug,name,user_id,active")
    .eq("slug", rep)
    .maybeSingle();
  const r = repRow.data as { name: string; user_id: string | null; active: boolean } | null;
  if (!r?.active) return json(404, { error: "That link isn't active." });

  // the same person on the same link today: one lead, one heads-up
  const again = await svc
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("rep_slug", rep)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if ((again.count ?? 0) > 0) return json(200, { ok: true });

  const allowed = await svc.rpc(
    "lead_intake_allowed" as never,
    { _ip: clientIp(request) } as never,
  );
  if (!allowed.error && allowed.data === false)
    return json(429, { error: "Too many tries from this network. Try again in an hour." });

  const utm: Record<string, string> = { ref: rep };
  if (body.utm && typeof body.utm === "object" && !Array.isArray(body.utm)) {
    for (const [k, v] of Object.entries(body.utm as Record<string, unknown>).slice(0, 10))
      if (/^utm_[a-z]{1,20}$/.test(k) && typeof v === "string") utm[k] = v.slice(0, 200);
  }
  const saved = await visitor()
    .from("leads")
    .insert({
      email,
      first_name: first,
      phone,
      answers: {
        source: "application_link",
        lastName: last,
        ...(consent ? { phoneConsent: `${new Date().toISOString()} | ${consent}` } : {}),
      } as never,
      utm: utm as never,
    });
  if (saved.error) return json(500, { error: "Couldn't save that. Try again." });

  // the heads-up: best effort, the lead is saved either way
  try {
    const profile = r.user_id
      ? await svc.from("profiles").select("email").eq("id", r.user_id).maybeSingle()
      : null;
    const repEmail = (profile?.data as { email?: string } | null)?.email ?? null;
    const to = recipients(repEmail, NEW_APPLICATION_COPY);
    const access = to ? await gmailAccessToken(svc) : null;
    if (to && access && !("error" in access)) {
      const m = startedEmail({ repName: r.name, first, last, phone, email, textsOk: !!consent });
      await fetch(GMAIL_SEND_URL(), {
        method: "POST",
        headers: { Authorization: `Bearer ${access.access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: b64url(
            buildMime({
              from: `${fromName("Lamp")} <${MAILBOX()}>`,
              to: to.to,
              cc: to.cc,
              subject: m.subject,
              body: m.text,
              attachments: [],
            }),
          ),
        }),
      });
    }
  } catch {
    /* the lead is on file; the rep sees it on the dashboard */
  }
  return json(200, { ok: true });
}
