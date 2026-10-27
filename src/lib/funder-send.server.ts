// Server side of sending files to funders and connecting the Gmail mailbox they go out from.
// Runs in the site's own server (TanStack Start server routes), which Lovable deploys on
// Publish, and reads its settings from the server environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY   (Lovable Cloud provides)
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET                              (Google OAuth web client)
//   FUNDER_SEND_SECRET                                                  (automatic sends only)
//   FUNDER_MAILBOX (default partners@getlamp.app), SITE_URL (default https://getlamp.app)
//
// Never import this file from browser code: the route files load it inside their handlers.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type Attachment,
  b64url,
  buildMime,
  emailText,
  type FileSummary,
  type Match,
  MAX_ATTACHMENT_BYTES,
  num,
  pickFunders,
  sameSecret,
  shortId,
} from "@/lib/funder-send";

export const env = (k: string) => (process.env[k] ?? "").trim();
export const SUPABASE_URL = () => env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
export const SERVICE_KEY = () => env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = () =>
  env("SUPABASE_PUBLISHABLE_KEY") ||
  env("SUPABASE_ANON_KEY") ||
  env("VITE_SUPABASE_PUBLISHABLE_KEY");
export const MAILBOX = () => (env("FUNDER_MAILBOX") || "partners@getlamp.app").toLowerCase();
export const SITE_URL = () => (env("SITE_URL") || "https://getlamp.app").replace(/\/$/, "");
// Overridable only so the local test can point these at a stand-in; production uses the defaults.
const GOOGLE_TOKEN_URL = () => env("GOOGLE_TOKEN_URL") || "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = () =>
  env("GMAIL_SEND_URL") || "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const USERINFO_URL = () =>
  env("GOOGLE_USERINFO_URL") || "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];
const STATE_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const service = () =>
  createClient(SUPABASE_URL(), SERVICE_KEY(), { auth: { persistSession: false } });

/** The signed-in caller's own client, so the database's rules apply to what they ask. */
export async function caller(request: Request) {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !ANON_KEY()) return null;
  const client = createClient(SUPABASE_URL(), ANON_KEY(), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const who = await client.auth.getUser(auth.slice(7));
  if (who.error || !who.data.user) return null;
  return { client, userId: who.data.user.id };
}

/** Which settings are present, as yes or no only. Shown to staff on the Funders page. */
export function sendingConfigured() {
  return {
    database: !!(SUPABASE_URL() && SERVICE_KEY() && ANON_KEY()),
    google: !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")),
    automatic: !!env("FUNDER_SEND_SECRET"),
    mailbox: MAILBOX(),
  };
}

type Body = {
  application_id?: string;
  funder_ids?: string[];
  application_pdf?: string;
  mode?: "manual" | "auto";
  dry_run?: boolean;
};

type Result = {
  funder_id: string;
  funder: string;
  status: "sent" | "skipped" | "failed" | "would_send";
  detail: string;
};

/**
 * POST /api/funders/send
 * Manual: a signed-in admin or the file's rep sends { application_id, funder_ids, application_pdf }.
 * Auto:   the documents trigger sends { application_id, mode: "auto" } with x-funder-send-secret.
 * dry_run returns the package and the emails without sending or writing anything.
 * Each funder gets its own email; a submission row is written first as a lock (unique per file
 * and funder), and a failed send removes it and writes the reason to the file's timeline.
 */
export async function sendToFunders(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const appId = body.application_id ?? "";
  if (!UUID.test(appId)) return json(400, { error: "application_id is required." });

  const svc = service();
  const mode: "manual" | "auto" = body.mode === "auto" ? "auto" : "manual";
  let actor: string | null = null;
  let matches: Match[];

  if (mode === "auto") {
    if (!sameSecret(request.headers.get("x-funder-send-secret") ?? "", env("FUNDER_SEND_SECRET"))) {
      return json(401, { error: "Not allowed." });
    }
    const r = await svc.rpc("_funder_matches" as never, { _application_id: appId } as never);
    if (r.error) return json(500, { error: "Couldn't match funders." });
    matches = (r.data ?? []) as Match[];
  } else {
    const who = await caller(request);
    if (!who) return json(401, { error: "Sign in first." });
    actor = who.userId;
    const r = await who.client.rpc("funder_matches", { _application_id: appId });
    if (r.error) {
      const denied = r.error.code === "42501";
      return json(denied ? 403 : 500, {
        error: denied ? r.error.message : "Couldn't match funders.",
      });
    }
    matches = (r.data ?? []) as Match[];
  }

  const picks = pickFunders(matches, mode, body.funder_ids ?? null);
  const toSend = picks.filter((p) => p.send);
  const results: Result[] = picks
    .filter((p) => !p.send)
    .map((p) => ({
      funder_id: p.match.funder_id,
      funder: p.match.funder_name,
      status: "skipped",
      detail: p.reason,
    }));
  if (toSend.length === 0) return json(200, { results, sent: 0 });

  const pkg = await buildPackage(svc, appId, mode, body);
  if ("error" in pkg) {
    if (mode === "auto")
      await timeline(svc, appId, null, "system", `Automatic send skipped: ${pkg.error}`, {});
    return json(409, { error: pkg.error, results });
  }

  if (body.dry_run) {
    for (const p of toSend) {
      const t = emailText(
        pkg.summary,
        p.match.funder_name,
        pkg.attachments.map((a) => a.name),
        MAILBOX(),
      );
      results.push({
        funder_id: p.match.funder_id,
        funder: p.match.funder_name,
        status: "would_send",
        detail: `${p.match.submission_email} · ${t.subject} · ${pkg.attachments.length} attachments, ${Math.round(pkg.bytes / 1024)} KB`,
      });
    }
    return json(200, {
      results,
      sent: 0,
      dry_run: true,
      attachments: pkg.attachments.map((a) => a.name),
    });
  }

  const token = await gmailAccessToken(svc);
  if ("error" in token) return json(412, { error: token.error, results });

  let sent = 0;
  for (const p of toSend) {
    const f = p.match;
    const names = pkg.attachments.map((a) => a.name);
    const lock = await svc
      .from("submissions")
      .insert({
        application_id: appId,
        funder_id: f.funder_id,
        submitted_by: actor,
        status: "submitted",
        sent_via: mode === "auto" ? "auto_email" : "email",
        sent_to: f.submission_email,
        attachments: names,
      })
      .select("id")
      .single();
    if (lock.error) {
      results.push({
        funder_id: f.funder_id,
        funder: f.funder_name,
        status: "skipped",
        detail:
          lock.error.code === "23505"
            ? "already sent this file"
            : lock.error.message === "changes_requested"
              ? "sent back for changes: waiting on the merchant"
              : "couldn't record the submission",
      });
      continue;
    }
    const contact = await svc
      .from("funders")
      .select("contact_name")
      .eq("id", f.funder_id)
      .maybeSingle();
    const t = emailText(pkg.summary, contact.data?.contact_name ?? null, names, MAILBOX());
    const raw = buildMime({
      from: `Lamp <${MAILBOX()}>`,
      to: f.submission_email!,
      subject: t.subject,
      body: t.body,
      attachments: pkg.attachments,
    });
    const res = await fetch(GMAIL_SEND_URL(), {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
    if (!res.ok) {
      const why = (await res.text()).slice(0, 300);
      await svc.from("submissions").delete().eq("id", lock.data.id);
      await timeline(
        svc,
        appId,
        actor,
        "system",
        `Sending to ${f.funder_name} failed (Gmail ${res.status}).`,
        {
          funder_id: f.funder_id,
          error: why,
        },
      );
      results.push({
        funder_id: f.funder_id,
        funder: f.funder_name,
        status: "failed",
        detail: `Gmail ${res.status}`,
      });
      continue;
    }
    const msg = (await res.json()) as { id?: string };
    await svc
      .from("submissions")
      .update({ email_message_id: msg.id ?? null })
      .eq("id", lock.data.id);
    await timeline(
      svc,
      appId,
      actor,
      "submitted_to_funder",
      `Sent ${pkg.summary.version && pkg.summary.version > 1 ? `the updated application (version ${pkg.summary.version}) ` : ""}to ${f.funder_name} at ${f.submission_email}${mode === "auto" ? " (automatic)" : ""}`,
      { funder_id: f.funder_id, message_id: msg.id ?? null, attachments: names },
    );
    results.push({
      funder_id: f.funder_id,
      funder: f.funder_name,
      status: "sent",
      detail: f.submission_email ?? "",
    });
    sent++;
  }

  if (sent > 0) {
    await svc
      .from("applications")
      .update({ status: "submitted" })
      .eq("id", appId)
      .in("status", ["new", "reviewing", "docs_needed"]);
  }
  return json(200, { results, sent });
}

async function timeline(
  svc: SupabaseClient,
  appId: string,
  actor: string | null,
  kind: string,
  text: string,
  payload: Record<string, unknown>,
) {
  await svc
    .from("events")
    .insert({ application_id: appId, actor_user_id: actor, kind, body: text, payload } as never);
}

type Package = { summary: FileSummary; attachments: Attachment[]; bytes: number };

async function buildPackage(
  svc: SupabaseClient,
  appId: string,
  mode: "manual" | "auto",
  body: Body,
): Promise<Package | { error: string }> {
  const [app, det, docs, open, newest, notes] = await Promise.all([
    svc
      .from("applications")
      .select("id,business_name,amount_requested,rep_slug")
      .eq("id", appId)
      .maybeSingle(),
    svc
      .from("application_details")
      .select("business,request,balances")
      .eq("application_id", appId)
      .maybeSingle(),
    svc
      .from("documents")
      .select("id,bucket,storage_path,kind,status,original_name,mime_type,created_at")
      .eq("application_id", appId)
      .in("status", ["received", "accepted"])
      .order("created_at", { ascending: true }),
    svc
      .from("application_change_requests")
      .select("id")
      .eq("application_id", appId)
      .eq("status", "open")
      .limit(1),
    svc
      .from("application_versions")
      .select("id,version")
      .eq("application_id", appId)
      .order("version", { ascending: false })
      .limit(1),
    svc
      .from("application_staff_additions")
      .select("created_at,source,body")
      .eq("application_id", appId)
      .eq("share_with_funders", true)
      .is("withdrawn_at", null)
      .order("created_at", { ascending: true })
      .limit(10),
  ]);
  if (app.error || !app.data) return { error: "file not found" };
  // "Send back for changes": nothing goes out while the merchant is updating, and an update goes
  // out only by hand, after the rep reviewed what changed, with the PDF built from it just now
  if (open.error || newest.error) return { error: "couldn't check whether the file was sent back" };
  if ((open.data ?? []).length)
    return { error: "sent back for changes: waiting on the merchant to sign the update" };
  const latest = (newest.data ?? [])[0] as { id: string; version: number } | undefined;
  if (latest && latest.version >= 2) {
    if (mode === "auto")
      return { error: "an updated application goes out by hand: send it from the file" };
    const answered = await svc
      .from("application_change_requests")
      .select("reviewed_at")
      .eq("result_version_id", latest.id)
      .maybeSingle();
    if (!(answered.data as { reviewed_at: string | null } | null)?.reviewed_at)
      return {
        error: "review what changed in the merchant's update first (Mark reviewed on the file)",
      };
    // a preview lists the PDF by name; a real send needs the one the page just built
    if (!body.application_pdf && !body.dry_run)
      return { error: "the updated application's PDF didn't arrive: send it again from the file" };
  }
  const a = app.data as {
    business_name: string | null;
    amount_requested: number | null;
    rep_slug: string | null;
  };
  const d = (det.data ?? null) as {
    business?: unknown;
    request?: unknown;
    balances?: unknown;
  } | null;
  const b = (d?.business ?? {}) as Partial<
    Record<"legal_name" | "dba" | "state" | "industry" | "start_date" | "monthly_revenue", string>
  >;
  const req = (d?.request ?? {}) as { amount?: string };
  const balances = (d?.balances ?? []) as { current?: string; payment?: string }[];
  let repName: string | null = null;
  if (a.rep_slug) {
    const rep = await svc.from("reps").select("name").eq("slug", a.rep_slug).maybeSingle();
    repName = (rep.data as { name?: string } | null)?.name ?? null;
  }
  const summary: FileSummary = {
    fileId: appId,
    legalName: b.legal_name || a.business_name || "",
    dba: b.dba || "",
    state: (b.state || "").toUpperCase(),
    industry: b.industry || "",
    startDate: b.start_date || "",
    monthlyDeposits: num(b.monthly_revenue),
    requested: num(req.amount) ?? a.amount_requested,
    openPositions: d
      ? balances.filter((x) => (num(x.current) ?? 0) > 0 || (num(x.payment) ?? 0) > 0).length
      : null,
    repName,
    version: latest?.version ?? 1,
    additions: ((notes.data ?? []) as { created_at: string; source: string; body: string }[]).map(
      (n) => ({
        at: n.created_at,
        source: n.source,
        body: n.body,
      }),
    ),
  };

  type Doc = {
    bucket: string;
    storage_path: string;
    kind: string;
    original_name: string | null;
    mime_type: string | null;
  };
  const all = (docs.data ?? []) as Doc[];
  const statements = all.filter((x) => x.kind === "bank_statement");
  if (statements.length < 3) return { error: `needs 3 bank statements, has ${statements.length}` };
  const extras = all.filter((x) => x.kind === "voided_check" || x.kind === "drivers_license");
  const storedApp = [...all].reverse().find((x) => x.kind === "funder_application");

  const attachments: Attachment[] = [];
  const label = summary.legalName.replace(/[^\w .&-]+/g, "").trim() || `file ${shortId(appId)}`;
  if (mode === "manual" && body.application_pdf) {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(body.application_pdf), (c) => c.charCodeAt(0));
    } catch {
      return { error: "the application PDF didn't arrive intact" };
    }
    if (bytes.length < 500 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
      return { error: "the application PDF didn't arrive intact" };
    }
    attachments.push({ name: `Lamp application - ${label}.pdf`, mime: "application/pdf", bytes });
  } else if (latest && latest.version >= 2) {
    // a preview of an updated application: the stored PDF is an older version, never attached
    attachments.push({
      name: `Lamp application - ${label}.pdf`,
      mime: "application/pdf",
      bytes: new Uint8Array(),
    });
  } else if (storedApp) {
    const f = await download(svc, storedApp);
    if ("error" in f) return f;
    attachments.push({ ...f, name: `Lamp application - ${label}.pdf` });
  } else {
    return { error: "no signed application yet" };
  }

  let n = 0;
  for (const x of statements) {
    const f = await download(svc, x);
    if ("error" in f) return f;
    n++;
    attachments.push({ ...f, name: `Bank statement ${n} - ${x.original_name || "statement"}` });
  }
  for (const x of extras) {
    const f = await download(svc, x);
    if ("error" in f) return f;
    attachments.push({
      ...f,
      name: `${x.kind === "voided_check" ? "Voided check" : "Driver's license"} - ${x.original_name || "file"}`,
    });
  }
  const bytes = attachments.reduce((s, x) => s + x.bytes.length, 0);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return {
      error: `the package is ${Math.round(bytes / 1048576)} MB, over the ${MAX_ATTACHMENT_BYTES / 1048576} MB email limit`,
    };
  }
  return { summary, attachments, bytes };
}

async function download(
  svc: SupabaseClient,
  d: {
    bucket: string;
    storage_path: string;
    mime_type: string | null;
    original_name: string | null;
  },
): Promise<Attachment | { error: string }> {
  const r = await svc.storage.from(d.bucket || "documents").download(d.storage_path);
  if (r.error || !r.data)
    return { error: `couldn't read ${d.original_name || d.storage_path} from storage` };
  return {
    name: d.original_name || "file",
    mime: d.mime_type || r.data.type || "application/octet-stream",
    bytes: new Uint8Array(await r.data.arrayBuffer()),
  };
}

export async function gmailAccessToken(
  svc: SupabaseClient,
): Promise<{ access: string } | { error: string }> {
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET")) {
    return { error: "Gmail sending isn't set up yet: the Google client settings are missing." };
  }
  const conn = await svc
    .from("mailer_connections" as never)
    .select("refresh_token")
    .eq("mailbox", MAILBOX())
    .maybeSingle();
  const row = conn.data as { refresh_token?: string } | null;
  if (conn.error || !row?.refresh_token) {
    return { error: `Connect the ${MAILBOX()} mailbox first (Funders page, admin).` };
  }
  const res = await fetch(GOOGLE_TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok)
    return {
      error: `Google refused the mailbox connection (${res.status}). Reconnect ${MAILBOX()}.`,
    };
  const t = (await res.json()) as { access_token?: string };
  return t.access_token ? { access: t.access_token } : { error: "Google sent no access token." };
}

const redirectUri = () => `${SITE_URL()}/api/gmail/callback`;
const back = (outcome: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `${SITE_URL()}/staff?view=funders&mailbox=${encodeURIComponent(outcome)}`,
    },
  });

/** POST /api/gmail/connect: an admin asks for Google's consent URL for the mailbox. */
export async function gmailConnectStart(request: Request): Promise<Response> {
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET")) {
    return json(412, {
      error: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server settings first.",
    });
  }
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const admin = await who.client.rpc("has_role", { _role: "admin" });
  if (admin.error || admin.data !== true)
    return json(403, { error: "Only an admin can connect the mailbox." });

  const svc = service();
  const state = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  await svc
    .from("oauth_states" as never)
    .delete()
    .lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
  const ins = await svc
    .from("oauth_states" as never)
    .insert({ state, user_id: who.userId } as never);
  if (ins.error) return json(500, { error: "Couldn't start the connection." });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: MAILBOX(),
    state,
  }).toString();
  return json(200, { url: url.toString(), mailbox: MAILBOX() });
}

/** GET /api/gmail/callback: Google sends the admin back here after the consent screen. */
export async function gmailCallback(request: Request): Promise<Response> {
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET")) return back("not_configured");
  const q = new URL(request.url).searchParams;
  if (q.get("error")) return back("declined");
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  if (!code || !/^[0-9a-f]{48}$/.test(state)) return back("bad_request");

  const svc = service();
  const st = await svc
    .from("oauth_states" as never)
    .delete()
    .eq("state", state)
    .select("user_id, created_at")
    .maybeSingle();
  const s = st.data as { user_id: string; created_at: string } | null;
  if (st.error || !s) return back("expired");
  if (Date.now() - new Date(s.created_at).getTime() > STATE_TTL_MS) return back("expired");

  const tok = await fetch(GOOGLE_TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tok.ok) return back("google_refused");
  const t = (await tok.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!t.access_token || !t.refresh_token) return back("no_refresh_token");
  if (!(t.scope ?? "").includes("gmail.send")) return back("send_not_allowed");

  const info = await fetch(USERINFO_URL(), {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const email = info.ok
    ? (((await info.json()) as { email?: string }).email ?? "").toLowerCase()
    : "";
  if (email !== MAILBOX()) return back("wrong_account");

  const up = await svc.from("mailer_connections" as never).upsert({
    mailbox: MAILBOX(),
    refresh_token: t.refresh_token,
    scope: t.scope ?? null,
    connected_by: s.user_id,
    connected_at: new Date().toISOString(),
  } as never);
  if (up.error) return back("save_failed");
  return back("connected");
}
