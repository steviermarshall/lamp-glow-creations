// Connects the Gmail mailbox that funder submissions go out from.
//
// POST { action: "start" } with an admin's session returns Google's consent URL. The browser
// goes there, the admin signs in as the mailbox (partners@getlamp.app) and allows "send email",
// and Google sends the browser back here (GET ?code&state). This exchanges the code, checks the
// account really is the mailbox, stores the refresh token in mailer_connections (service role
// only) and returns the admin to /staff. Nobody, Claude included, ever sees or copies the token.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const MAILBOX = (Deno.env.get("FUNDER_MAILBOX") ?? "partners@getlamp.app").toLowerCase();
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://getlamp.app").replace(/\/$/, "");
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-connect`;
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];
const STATE_TTL_MS = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const back = (outcome: string) =>
  Response.redirect(`${SITE_URL}/staff?view=funders&mailbox=${encodeURIComponent(outcome)}`, 302);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "The function is missing its Supabase settings." });
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return req.method === "GET" ? back("not_configured") : json(412, { error: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the function secrets first." });
  }
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (req.method === "POST") {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ") || !ANON_KEY) return json(401, { error: "Sign in first." });
    const user = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const who = await user.auth.getUser();
    if (who.error || !who.data.user) return json(401, { error: "Sign in first." });
    const admin = await user.rpc("has_role", { _role: "admin" });
    if (admin.error || admin.data !== true) return json(403, { error: "Only an admin can connect the mailbox." });

    const state = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    await svc.from("oauth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
    const ins = await svc.from("oauth_states").insert({ state, user_id: who.data.user.id });
    if (ins.error) return json(500, { error: "Couldn't start the connection." });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      login_hint: MAILBOX,
      state,
    }).toString();
    return json(200, { url: url.toString(), mailbox: MAILBOX });
  }

  if (req.method !== "GET") return json(405, { error: "GET or POST only" });
  const q = new URL(req.url).searchParams;
  if (q.get("error")) return back("declined");
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  if (!code || !/^[0-9a-f]{48}$/.test(state)) return back("bad_request");

  // One use only, and only within ten minutes of being issued.
  const st = await svc.from("oauth_states").delete().eq("state", state).select("user_id, created_at").maybeSingle();
  if (st.error || !st.data) return back("expired");
  if (Date.now() - new Date(st.data.created_at).getTime() > STATE_TTL_MS) return back("expired");

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tok.ok) return back("google_refused");
  const t = (await tok.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!t.access_token || !t.refresh_token) return back("no_refresh_token");
  if (!(t.scope ?? "").includes("gmail.send")) return back("send_not_allowed");

  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const email = info.ok ? (((await info.json()) as { email?: string }).email ?? "").toLowerCase() : "";
  if (email !== MAILBOX) return back(`wrong_account`);

  const up = await svc.from("mailer_connections").upsert({
    mailbox: MAILBOX,
    refresh_token: t.refresh_token,
    scope: t.scope ?? null,
    connected_by: st.data.user_id,
    connected_at: new Date().toISOString(),
  });
  if (up.error) return back("save_failed");
  return back("connected");
});
