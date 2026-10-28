// Server side of the staff Team tab (GET and POST /api/team): admins add reps by name and email,
// pick the admin each rep reports to, make someone an admin, switch a rep off and resend the
// welcome email. A new person gets a role invite that their first sign-in claims
// (handle_new_user); someone who already has a Lamp login gets the role at once. The welcome
// email goes from partners@ through the same Gmail connection as application links.
// Never import this from browser code.
import { caller, gmailAccessToken, json, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { gmailSend, readJson } from "@/lib/application-links.server";
import { EMAIL_RE, cleanEmail } from "@/lib/application-links";
import { SITE } from "@/lib/site";

type Svc = ReturnType<typeof service>;

export type TeamRow = {
  slug: string;
  name: string;
  title: string | null;
  active: boolean;
  admin_slug: string | null;
  email: string | null;
  /** Signed in at least once and linked to this seat. */
  linked: boolean;
  is_admin: boolean;
  /** Waiting for their first sign-in. */
  invited_at: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** The signed-in admin, or a Response to send back. */
async function admin(request: Request): Promise<{ userId: string; svc: Svc } | Response> {
  if (!SUPABASE_URL()) return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const svc = service();
  const r = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", who.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!r.data) return json(403, { error: "Only admins manage the team." });
  return { userId: who.userId, svc };
}

/** Everyone with a rep seat, with their login, admin role and invite state. */
async function team(svc: Svc): Promise<TeamRow[]> {
  const [reps, invites] = await Promise.all([
    svc.from("reps").select("slug,name,title,active,admin_slug,user_id").order("name"),
    svc.from("role_invites").select("email,roles,rep_slug,created_at,claimed_at"),
  ]);
  const seats = (reps.data ?? []) as {
    slug: string;
    name: string;
    title: string | null;
    active: boolean;
    admin_slug: string | null;
    user_id: string | null;
  }[];
  const ids = seats.map((s) => s.user_id).filter((x): x is string => !!x);
  const [profiles, roles] = ids.length
    ? await Promise.all([
        svc.from("profiles").select("id,email").in("id", ids),
        svc.from("user_roles").select("user_id").eq("role", "admin").in("user_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const emailOf = new Map(
    ((profiles.data ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]),
  );
  const admins = new Set(((roles.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const inv = (invites.data ?? []) as {
    email: string;
    roles: string[];
    rep_slug: string | null;
    created_at: string;
    claimed_at: string | null;
  }[];
  return seats.map((s) => {
    const open = inv.find((i) => i.rep_slug === s.slug && !i.claimed_at);
    return {
      slug: s.slug,
      name: s.name,
      title: s.title,
      active: s.active,
      admin_slug: s.admin_slug,
      email: (s.user_id ? emailOf.get(s.user_id) : null) ?? open?.email ?? null,
      linked: !!s.user_id,
      is_admin: s.user_id ? admins.has(s.user_id) : !!open?.roles.includes("admin"),
      invited_at: !s.user_id && open ? open.created_at : null,
    };
  });
}

/** A free slug from the first name: "zeus", then "zeus-2", "zeus-3"... */
async function freeSlug(svc: Svc, name: string): Promise<string> {
  const base =
    (name.toLowerCase().split(/\s+/)[0] ?? "")
      .normalize("NFD")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 24) || "rep";
  const stem = base.length < 2 ? `${base}rep` : base;
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? stem : `${stem}-${n}`;
    const r = await svc.from("reps").select("slug").eq("slug", slug).maybeSingle();
    if (!r.data) return slug;
  }
  throw new Error("no free slug");
}

function welcomeEmail(o: {
  first: string;
  inviter: string;
  lead: string | null;
  slug: string;
  site: string;
  email: string;
}) {
  const site = o.site.replace(/\/$/, "");
  return {
    subject: "You're on the Lamp team",
    text: [
      `Hi ${o.first},`,
      "",
      `${o.inviter} added you to Lamp as a rep${o.lead ? `, on ${o.lead}'s team` : ""}.`,
      "",
      `Sign in at ${site}/login with this email address (${o.email}). We'll email you a sign-in link; there's no password.`,
      "",
      "Your application links, to send to merchants:",
      `  Step by step: ${site}/application/${o.slug}`,
      `  One-page form: ${site}/application/${o.slug}/pdf`,
      o.lead
        ? `Applications you send go out in ${o.lead}'s name, and signed files land in your Files on the staff page.`
        : "Signed files land in your Files on the staff page.",
      "",
      `${SITE.legalName}`,
    ].join("\n"),
  };
}

async function sendWelcome(svc: Svc, row: TeamRow, inviterId: string): Promise<string | null> {
  if (!row.email) return "No email address for this rep.";
  const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in access) return access.error;
  const [inviter, lead] = await Promise.all([
    svc.from("reps").select("name").eq("user_id", inviterId).maybeSingle(),
    row.admin_slug
      ? svc.from("reps").select("name").eq("slug", row.admin_slug).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const inviterProfile = await svc
    .from("profiles")
    .select("email")
    .eq("id", inviterId)
    .maybeSingle();
  const mail = welcomeEmail({
    first: row.name.split(" ")[0] ?? row.name,
    inviter: (inviter.data as { name: string } | null)?.name ?? "Lamp",
    lead: (lead.data as { name: string } | null)?.name ?? null,
    slug: row.slug,
    site: SITE.url,
    email: row.email,
  });
  const sent = await gmailSend(access.access, {
    to: row.email,
    fromName: "Lamp",
    replyTo: (inviterProfile.data as { email: string | null } | null)?.email ?? null,
    subject: mail.subject,
    text: mail.text,
  });
  return "error" in sent ? sent.error : null;
}

/** GET /api/team: the team, admins only. */
export async function listTeam(request: Request): Promise<Response> {
  const a = await admin(request);
  if (a instanceof Response) return a;
  return json(200, { team: await team(a.svc) });
}

type Body = {
  action?: unknown;
  name?: unknown;
  email?: unknown;
  title?: unknown;
  slug?: unknown;
  admin_slug?: unknown;
  make_admin?: unknown;
  active?: unknown;
};

/** POST /api/team: { action: "add" | "update" | "invite", ... }, admins only. */
export async function changeTeam(request: Request): Promise<Response> {
  const a = await admin(request);
  if (a instanceof Response) return a;
  const { svc, userId } = a;
  const body = await readJson<Body>(request, 4096);
  if (body instanceof Response) return body;
  const leadSlug =
    typeof body.admin_slug === "string" && SLUG.test(body.admin_slug) ? body.admin_slug : null;
  if (leadSlug) {
    const lead = await svc.from("reps").select("slug").eq("slug", leadSlug).maybeSingle();
    if (!lead.data) return json(400, { error: "That admin isn't on the team." });
  }

  if (body.action === "add") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    const email = cleanEmail(typeof body.email === "string" ? body.email : "");
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) || null : null;
    const makeAdmin = body.make_admin === true;
    if (name.split(/\s+/).filter(Boolean).length < 1)
      return json(400, { error: "Add their name." });
    if (!EMAIL_RE.test(email))
      return json(400, { error: "That email address doesn't look right." });
    const taken = await svc
      .from("role_invites")
      .select("email,claimed_at")
      .eq("email", email)
      .maybeSingle();
    const existing = await svc.from("profiles").select("id").ilike("email", email).maybeSingle();
    const userId2 = (existing.data as { id: string } | null)?.id ?? null;
    if (userId2) {
      const seat = await svc.from("reps").select("slug").eq("user_id", userId2).maybeSingle();
      if (seat.data) return json(409, { error: "That person already has a rep seat." });
    } else if (taken.data && !(taken.data as { claimed_at: string | null }).claimed_at) {
      return json(409, { error: "That email already has an invite waiting." });
    }
    const slug = await freeSlug(svc, name);
    const ins = await svc
      .from("reps")
      .insert({ slug, name, title, admin_slug: leadSlug, active: true, user_id: userId2 } as never);
    if (ins.error) return json(500, { error: "Couldn't add the rep. Try again." });
    const roles = makeAdmin ? ["rep", "admin"] : ["rep"];
    if (userId2) {
      // already has a Lamp login: give the roles now
      await svc
        .from("user_roles")
        .upsert(roles.map((role) => ({ user_id: userId2, role })) as never, {
          onConflict: "user_id,role",
          ignoreDuplicates: true,
        });
      await svc.from("role_invites").upsert(
        {
          email,
          roles,
          rep_slug: slug,
          invited_by: userId,
          claimed_by: userId2,
          claimed_at: new Date().toISOString(),
        } as never,
        { onConflict: "email" },
      );
    } else {
      const up = await svc.from("role_invites").upsert(
        {
          email,
          roles,
          rep_slug: slug,
          invited_by: userId,
          claimed_by: null,
          claimed_at: null,
        } as never,
        { onConflict: "email" },
      );
      if (up.error) {
        await svc.from("reps").delete().eq("slug", slug);
        return json(500, { error: "Couldn't save the invite. Try again." });
      }
    }
    const row = (await team(svc)).find((r) => r.slug === slug)!;
    const emailError = await sendWelcome(svc, row, userId);
    return json(200, { row, emailed: !emailError, email_error: emailError });
  }

  const slug = typeof body.slug === "string" && SLUG.test(body.slug) ? body.slug : "";
  const row = (await team(svc)).find((r) => r.slug === slug);
  if (!row) return json(404, { error: "That rep isn't on the team." });

  if (body.action === "invite") {
    if (row.linked) return json(400, { error: "They've already signed in." });
    const emailError = await sendWelcome(svc, row, userId);
    return emailError ? json(502, { error: emailError }) : json(200, { row, emailed: true });
  }

  if (body.action === "update") {
    const patch: Record<string, unknown> = {};
    if ("admin_slug" in body) {
      if (leadSlug === slug) return json(400, { error: "A rep can't report to themselves." });
      patch["admin_slug"] = leadSlug;
    }
    if (typeof body.active === "boolean") patch["active"] = body.active;
    if (Object.keys(patch).length) {
      const up = await svc
        .from("reps")
        .update(patch as never)
        .eq("slug", slug);
      if (up.error) return json(500, { error: "Couldn't save that. Try again." });
    }
    if (typeof body.make_admin === "boolean") {
      const seat = await svc.from("reps").select("user_id").eq("slug", slug).maybeSingle();
      const uid = (seat.data as { user_id: string | null } | null)?.user_id ?? null;
      if (uid === userId && !body.make_admin)
        return json(400, { error: "You can't take away your own admin role." });
      if (uid) {
        if (body.make_admin)
          await svc.from("user_roles").upsert({ user_id: uid, role: "admin" } as never, {
            onConflict: "user_id,role",
            ignoreDuplicates: true,
          });
        else await svc.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
      } else if (row.email) {
        await svc
          .from("role_invites")
          .update({ roles: body.make_admin ? ["rep", "admin"] : ["rep"] } as never)
          .eq("email", row.email);
      }
    }
    const next = (await team(svc)).find((r) => r.slug === slug)!;
    return json(200, { row: next });
  }

  return json(400, { error: "Unknown action." });
}
