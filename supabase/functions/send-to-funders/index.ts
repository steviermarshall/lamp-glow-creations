// Sends a file to its matched funders from the connected Gmail mailbox (partners@getlamp.app).
//
// Manual: a signed-in admin or the file's rep posts { application_id, funder_ids, application_pdf }
//   with their own session. funder_matches() enforces who may send and which funders qualify;
//   application_pdf is the signed application the staff browser built through
//   reveal_application_details('funder_submission'), which logged the access.
// Auto:   the documents trigger posts { application_id, mode: "auto" } with the shared secret.
//   It sends to eligible funders with auto_send on, attaching the signed application PDF the
//   merchant stored when they signed.
// dry_run: true returns the package and the emails without sending or writing anything.
//
// Each funder gets its own email. A submission row is written before the send as a lock
// (unique per file and funder), so two calls can't send the same file to the same funder twice;
// a failed send removes the row and writes the reason to the file's timeline.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
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
} from "../_shared/funder-send.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SEND_SECRET = Deno.env.get("FUNDER_SEND_SECRET") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const MAILBOX = (Deno.env.get("FUNDER_MAILBOX") ?? "partners@getlamp.app").toLowerCase();
const FROM = `Lamp <${MAILBOX}>`;
// Overridable only so the local test can point these at a stand-in; production uses the defaults.
const GOOGLE_TOKEN_URL = Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = Deno.env.get("GMAIL_SEND_URL") ?? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-funder-send-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Body = {
  application_id?: string;
  funder_ids?: string[];
  application_pdf?: string; // base64
  application_pdf_name?: string;
  mode?: "manual" | "auto";
  dry_run?: boolean;
};

type Result = { funder_id: string; funder: string; status: "sent" | "skipped" | "failed" | "would_send"; detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "The function is missing its Supabase settings." });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const appId = body.application_id ?? "";
  if (!UUID.test(appId)) return json(400, { error: "application_id is required." });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const mode: "manual" | "auto" = body.mode === "auto" ? "auto" : "manual";
  let actor: string | null = null;
  let matches: Match[];

  // Who is asking, and what the database says the file matches.
  if (mode === "auto") {
    if (!sameSecret(req.headers.get("x-funder-send-secret") ?? "", SEND_SECRET)) {
      return json(401, { error: "Not allowed." });
    }
    const r = await svc.rpc("_funder_matches", { _application_id: appId });
    if (r.error) return json(500, { error: "Couldn't match funders.", detail: r.error.message });
    matches = (r.data ?? []) as Match[];
  } else {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ") || !ANON_KEY) return json(401, { error: "Sign in first." });
    const user = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const who = await user.auth.getUser();
    if (who.error || !who.data.user) return json(401, { error: "Sign in first." });
    actor = who.data.user.id;
    const r = await user.rpc("funder_matches", { _application_id: appId });
    if (r.error) {
      const denied = r.error.code === "42501";
      return json(denied ? 403 : 500, { error: denied ? r.error.message : "Couldn't match funders." });
    }
    matches = (r.data ?? []) as Match[];
  }

  const picks = pickFunders(matches, mode, body.funder_ids ?? null);
  const toSend = picks.filter((p) => p.send);
  const results: Result[] = picks
    .filter((p) => !p.send)
    .map((p) => ({ funder_id: p.match.funder_id, funder: p.match.funder_name, status: "skipped", detail: p.reason }));
  if (toSend.length === 0) return json(200, { results, sent: 0 });

  // The file and its package.
  const pkg = await buildPackage(svc, appId, mode, body);
  if ("error" in pkg) {
    if (mode === "auto") await timeline(svc, appId, null, "system", `Automatic send skipped: ${pkg.error}`, {});
    return json(409, { error: pkg.error, results });
  }

  if (body.dry_run) {
    for (const p of toSend) {
      const t = emailText(pkg.summary, p.match.funder_name, pkg.attachments.map((a) => a.name), MAILBOX);
      results.push({
        funder_id: p.match.funder_id,
        funder: p.match.funder_name,
        status: "would_send",
        detail: `${p.match.submission_email} · ${t.subject} · ${pkg.attachments.length} attachments, ${Math.round(pkg.bytes / 1024)} KB`,
      });
    }
    return json(200, { results, sent: 0, dry_run: true, attachments: pkg.attachments.map((a) => a.name) });
  }

  const token = await gmailAccessToken(svc);
  if ("error" in token) return json(412, { error: token.error, results });

  let sent = 0;
  for (const p of toSend) {
    const f = p.match;
    const names = pkg.attachments.map((a) => a.name);
    // Lock first: the unique (application_id, funder_id) makes a second send impossible.
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
        detail: lock.error.code === "23505" ? "already sent this file" : "couldn't record the submission",
      });
      continue;
    }
    const contact = await svc.from("funders").select("contact_name").eq("id", f.funder_id).maybeSingle();
    const t = emailText(pkg.summary, contact.data?.contact_name ?? null, names, MAILBOX);
    const raw = buildMime({ from: FROM, to: f.submission_email!, subject: t.subject, body: t.body, attachments: pkg.attachments });
    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
    if (!res.ok) {
      const why = (await res.text()).slice(0, 300);
      await svc.from("submissions").delete().eq("id", lock.data.id);
      await timeline(svc, appId, actor, "system", `Sending to ${f.funder_name} failed (Gmail ${res.status}).`, {
        funder_id: f.funder_id,
        error: why,
      });
      results.push({ funder_id: f.funder_id, funder: f.funder_name, status: "failed", detail: `Gmail ${res.status}` });
      continue;
    }
    const msg = (await res.json()) as { id?: string };
    await svc.from("submissions").update({ email_message_id: msg.id ?? null }).eq("id", lock.data.id);
    await timeline(
      svc,
      appId,
      actor,
      "submitted_to_funder",
      `Sent to ${f.funder_name} at ${f.submission_email}${mode === "auto" ? " (automatic)" : ""}`,
      { funder_id: f.funder_id, message_id: msg.id ?? null, attachments: names },
    );
    results.push({ funder_id: f.funder_id, funder: f.funder_name, status: "sent", detail: f.submission_email ?? "" });
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
});

async function timeline(
  svc: SupabaseClient,
  appId: string,
  actor: string | null,
  kind: string,
  text: string,
  payload: Record<string, unknown>,
) {
  await svc.from("events").insert({ application_id: appId, actor_user_id: actor, kind, body: text, payload });
}

type Package = { summary: FileSummary; attachments: Attachment[]; bytes: number };

async function buildPackage(
  svc: SupabaseClient,
  appId: string,
  mode: "manual" | "auto",
  body: Body,
): Promise<Package | { error: string }> {
  const [app, det, docs] = await Promise.all([
    svc.from("applications").select("id,business_name,amount_requested,rep_slug,answers").eq("id", appId).maybeSingle(),
    svc.from("application_details").select("business,request,balances,signed_at").eq("application_id", appId).maybeSingle(),
    svc
      .from("documents")
      .select("id,bucket,storage_path,kind,status,original_name,mime_type,size_bytes,created_at")
      .eq("application_id", appId)
      .in("status", ["received", "accepted"])
      .order("created_at", { ascending: true }),
  ]);
  if (app.error || !app.data) return { error: "file not found" };
  const b = (det.data?.business ?? {}) as Record<string, string>;
  const req = (det.data?.request ?? {}) as Record<string, string>;
  const balances = (det.data?.balances ?? []) as Record<string, string>[];
  let repName: string | null = null;
  if (app.data.rep_slug) {
    const rep = await svc.from("reps").select("name").eq("slug", app.data.rep_slug).maybeSingle();
    repName = rep.data?.name ?? null;
  }
  const summary: FileSummary = {
    fileId: appId,
    legalName: b.legal_name || app.data.business_name || "",
    dba: b.dba || "",
    state: (b.state || "").toUpperCase(),
    industry: b.industry || "",
    startDate: b.start_date || "",
    monthlyDeposits: num(b.monthly_revenue),
    requested: num(req.amount) ?? app.data.amount_requested,
    openPositions: det.data
      ? balances.filter((x) => (num(x.current) ?? 0) > 0 || (num(x.payment) ?? 0) > 0).length
      : null,
    repName,
  };

  const all = docs.data ?? [];
  const statements = all.filter((d) => d.kind === "bank_statement");
  if (statements.length < 3) return { error: `needs 3 bank statements, has ${statements.length}` };
  const extras = all.filter((d) => d.kind === "voided_check" || d.kind === "drivers_license");
  const storedApp = [...all].reverse().find((d) => d.kind === "funder_application");

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
  } else if (storedApp) {
    const f = await download(svc, storedApp);
    if ("error" in f) return f;
    attachments.push({ ...f, name: `Lamp application - ${label}.pdf` });
  } else {
    return { error: "no signed application yet" };
  }

  let n = 0;
  for (const d of statements) {
    const f = await download(svc, d);
    if ("error" in f) return f;
    n++;
    attachments.push({ ...f, name: `Bank statement ${n} - ${d.original_name || "statement"}` });
  }
  for (const d of extras) {
    const f = await download(svc, d);
    if ("error" in f) return f;
    attachments.push({
      ...f,
      name: `${d.kind === "voided_check" ? "Voided check" : "Driver's license"} - ${d.original_name || "file"}`,
    });
  }
  const bytes = attachments.reduce((s, a) => s + a.bytes.length, 0);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { error: `the package is ${Math.round(bytes / 1048576)} MB, over the ${MAX_ATTACHMENT_BYTES / 1048576} MB email limit` };
  }
  return { summary, attachments, bytes };
}

async function download(
  svc: SupabaseClient,
  d: { bucket: string; storage_path: string; mime_type: string | null; original_name: string | null },
): Promise<Attachment | { error: string }> {
  const r = await svc.storage.from(d.bucket || "documents").download(d.storage_path);
  if (r.error || !r.data) return { error: `couldn't read ${d.original_name || d.storage_path} from storage` };
  return {
    name: d.original_name || "file",
    mime: d.mime_type || r.data.type || "application/octet-stream",
    bytes: new Uint8Array(await r.data.arrayBuffer()),
  };
}

async function gmailAccessToken(svc: SupabaseClient): Promise<{ access: string } | { error: string }> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { error: "Gmail sending isn't set up yet: the Google client settings are missing." };
  }
  const conn = await svc.from("mailer_connections").select("refresh_token").eq("mailbox", MAILBOX).maybeSingle();
  if (conn.error || !conn.data) {
    return { error: `Connect the ${MAILBOX} mailbox first (Funders page, admin).` };
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conn.data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return { error: `Google refused the mailbox connection (${res.status}). Reconnect ${MAILBOX}.` };
  const t = (await res.json()) as { access_token?: string };
  return t.access_token ? { access: t.access_token } : { error: "Google sent no access token." };
}
