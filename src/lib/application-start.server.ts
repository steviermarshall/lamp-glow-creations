// Server side of the application link's first screen (POST /api/application/start): someone on a
// rep's public link answers the quick questions (the front page's) and gives their name, business,
// phone and email before the long form. That's saved at once
// as a lead with the rep (utm.ref, through leads_before_insert), and the rep is emailed, with Asad
// and Stevie copied, so they can call while the person is still on the page. Once per email and
// rep a day, and within the lead form's per-network limit. If the save fails twice the email still
// goes, marked "Not saved in Lamp" (see application-start.ts). Never import this from browser code.
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
import { EMAIL_RE, fromName, hashToken, isToken, newToken } from "@/lib/application-links";
import { isStage, rank, type Stage } from "@/lib/application-progress";
import { NEW_APPLICATION_COPY } from "@/lib/site";
import { cleanChoices } from "@/lib/apply";
import {
  gmailSend,
  runStart,
  startFailureLine,
  type Mail,
  type SendResult,
  type StartFailure,
  type StartRep,
} from "@/lib/application-start";

const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const DAY_MS = 86_400_000;

type Body = {
  rep?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  email?: unknown;
  business_name?: unknown;
  phone_consent?: unknown;
  /** The quick questions, by the front page's keys and choice ids (amount, purpose, ...). */
  answers?: unknown;
  utm?: unknown;
  /** Which public link: the step-by-step application ("online") or the one-page form ("pdf"). */
  form?: unknown;
};

type Progress = { stage: Stage; at: string; form: "online" | "pdf" };

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
  const businessName = text(body.business_name, 200);
  const quick = cleanChoices(body.answers);
  // "" is the website's own application (getlamp.app/application): no rep, the file is unassigned
  const website = rep === "";
  if (!website && !SLUG.test(rep)) return json(400, { error: "That link isn't right." });
  if (!first || !last) return json(400, { error: "Add your first and last name." });
  if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email." });
  if (digits.length < 10 || digits.length > 11)
    return json(400, { error: "Enter a 10-digit phone number." });

  const svc = service();
  const form = body.form === "pdf" ? "pdf" : "online";
  // a rep's link carries ref (leads_before_insert gives the lead that rep); the website none
  const utm: Record<string, string> = website ? { utm_source: "website" } : { ref: rep };
  if (body.utm && typeof body.utm === "object" && !Array.isArray(body.utm)) {
    for (const [k, v] of Object.entries(body.utm as Record<string, unknown>).slice(0, 10))
      if (/^utm_[a-z]{1,20}$/.test(k) && typeof v === "string") utm[k] = v.slice(0, 200);
  }
  const lead = {
    email,
    first_name: first,
    phone,
    answers: {
      ...quick,
      source: "application_link",
      ...(website ? { website: true } : {}),
      form,
      lastName: last,
      ...(businessName ? { businessName } : {}),
      ...(consent ? { phoneConsent: `${new Date().toISOString()} | ${consent}` } : {}),
    } as never,
    utm: utm as never,
  };

  // the order (rep, same person today, network cap, save twice, heads-up) is in runStart,
  // application-start.ts, where it's unit-tested; this hands it the database and Gmail
  const reply = await runStart(
    { rep, first, last, email, phone, businessName, textsOk: !!consent, quick },
    {
      copy: NEW_APPLICATION_COPY,
      findRep: async (slug) => {
        try {
          const got = await svc
            .from("reps")
            .select("slug,name,user_id,active")
            .eq("slug", slug)
            .maybeSingle();
          return { rep: got.data as StartRep | null, error: !!got.error };
        } catch {
          return { rep: null, error: true };
        }
      },
      seenToday: async () => {
        // on the website, "the same link" is the website: leads with no rep
        try {
          const recent = svc
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("email", email)
            .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
          const again = await (website ? recent.is("rep_slug", null) : recent.eq("rep_slug", rep));
          return (again.count ?? 0) > 0;
        } catch {
          return false;
        }
      },
      intakeAllowed: async () => {
        try {
          const allowed = await svc.rpc(
            "lead_intake_allowed" as never,
            { _ip: clientIp(request) } as never,
          );
          return !(!allowed.error && allowed.data === false);
        } catch {
          return true;
        }
      },
      insertLead: async () => {
        try {
          const saved = await visitor().from("leads").insert(lead);
          return !saved.error;
        } catch {
          return false;
        }
      },
      repEmail: async (userId) => {
        const profile = await svc.from("profiles").select("email").eq("id", userId).maybeSingle();
        return (profile.data as { email?: string } | null)?.email ?? null;
      },
      send: (m) => sendHeadsUp(svc, m),
      progress: () => linkProgress(svc, email, rep, form),
      fail: countFailure,
      pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
  );
  return json(reply.status, reply.body);
}

// How many starts went wrong, by reason, since this server started: logged with no name, email
// or phone, so a run of failures shows in the logs. (A dashboard count waits for the site_events
// 'action' kind.)
const failures = new Map<StartFailure, number>();
function countFailure(reason: StartFailure, detail?: string) {
  const n = (failures.get(reason) ?? 0) + 1;
  failures.set(reason, n);
  console.warn(startFailureLine(reason, n, detail));
}

/** The heads-up through the company mailbox (gmailSend says why when it didn't go). */
function sendHeadsUp(svc: ReturnType<typeof service>, m: Mail): Promise<SendResult> {
  return gmailSend(m, {
    token: () => gmailAccessToken(svc),
    post: (access, mail) =>
      fetch(GMAIL_SEND_URL(), {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: b64url(
            buildMime({
              from: `${fromName("Lamp")} <${MAILBOX()}>`,
              to: mail.to,
              cc: mail.cc,
              subject: mail.subject,
              body: mail.text,
              attachments: [],
            }),
          ),
        }),
      }),
  });
}

/**
 * Ties a fresh progress token to the person's latest lead with this rep (its hash in
 * answers.progressHash) and returns the token, or null when the lead can't be found.
 */
async function linkProgress(
  svc: ReturnType<typeof service>,
  email: string,
  rep: string,
  form: "online" | "pdf",
): Promise<string | null> {
  try {
    const q = svc.from("leads").select("id,answers").eq("email", email);
    const got = await (rep ? q.eq("rep_slug", rep) : q.is("rep_slug", null))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lead = got.data as { id: string; answers: Record<string, unknown> | null } | null;
    if (!lead) return null;
    const token = newToken();
    const answers: Record<string, unknown> = {
      ...(lead.answers ?? {}),
      progressHash: await hashToken(token),
    };
    // a lead that started on one link and came back on the other is counted on the newer one
    if (!answers["progress"])
      answers["progress"] = { stage: "contact", at: new Date().toISOString(), form };
    else answers["form"] = form;
    const up = await svc
      .from("leads")
      .update({ answers } as never)
      .eq("id", lead.id);
    return up.error ? null : token;
  } catch {
    return null;
  }
}

/** POST /api/application/progress: { token, stage, form }. Keeps the furthest stage. Always 204. */
export async function recordProgress(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (!SUPABASE_URL()) return done;
  const body = await readJson<{ token?: unknown; stage?: unknown; form?: unknown }>(request, 1024);
  if (body instanceof Response) return done;
  if (!isToken(body.token) || !isStage(body.stage)) return done;
  try {
    const svc = service();
    const got = await svc
      .from("leads")
      .select("id,answers")
      .eq("answers->>progressHash", await hashToken(body.token))
      .limit(1)
      .maybeSingle();
    const lead = got.data as { id: string; answers: Record<string, unknown> | null } | null;
    if (!lead) return done;
    const answers: Record<string, unknown> = { ...(lead.answers ?? {}) };
    const before = answers["progress"] as Partial<Progress> | undefined;
    const was = isStage(before?.stage) ? rank(before.stage) : -1;
    if (rank(body.stage) <= was) return done;
    const progress: Progress = {
      stage: body.stage,
      at: new Date().toISOString(),
      form: body.form === "pdf" ? "pdf" : "online",
    };
    answers["progress"] = progress;
    await svc
      .from("leads")
      .update({ answers } as never)
      .eq("id", lead.id);
  } catch {
    /* best effort */
  }
  return done;
}
