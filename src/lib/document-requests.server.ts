// Document requests: staff ask a merchant for documents with a link the merchant drops files into
// (migration 20261030090000_document_requests.sql). Never import this from browser code: the route
// files load it inside their handlers.
//
//   POST /api/documents/request          staff: make a request (or replace a lost link), get the link
//   GET  /api/documents/request?token=   the merchant's page: what's asked and what came in
//   POST /api/documents/request-upload   the merchant's page: one file for one item
//
// The database keeps only a hash of the link's secret. The link can only add files to its own
// file: it never shows the merchant anything already stored beyond the names of what they sent.

import { caller, json, service, SUPABASE_URL, SERVICE_KEY } from "@/lib/funder-send.server";
import { readCapped, readJson, uploadType, looksLikePdf } from "@/lib/application-links.server";
import {
  hashToken,
  isToken,
  MAX_UPLOAD_BYTES,
  newToken,
  UPLOAD_TYPES,
} from "@/lib/application-links";
import { DOC_ITEMS, type DocItemKey, docItem } from "@/lib/document-requests";
import { SITE } from "@/lib/site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES = 30;

const ready = () =>
  SUPABASE_URL() && SERVICE_KEY()
    ? null
    : json(500, { error: "The server is missing its database settings." });

type Item = { key: DocItemKey; label: string };

/** Items as sent by the staff form: known keys, a label for each (the months, the "other" text). */
function cleanItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const out: Item[] = [];
  for (const r of raw.slice(0, 12)) {
    if (!r || typeof r !== "object") continue;
    const { key, label } = r as { key?: unknown; label?: unknown };
    if (typeof key !== "string" || !(key in DOC_ITEMS)) continue;
    const text = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    out.push({ key: key as DocItemKey, label: text || DOC_ITEMS[key as DocItemKey].label });
  }
  return out;
}

const linkFor = (token: string) => `${SITE.url.replace(/\/$/, "")}/upload/${token}`;

// ---------- POST /api/documents/request (staff) ----------

export async function createDocumentRequest(request: Request): Promise<Response> {
  const nr = ready();
  if (nr) return nr;
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const body = await readJson<{
    application_id?: string;
    title?: string;
    items?: unknown;
    note?: string;
    replace_id?: string;
    close_id?: string;
  }>(request, 16 * 1024);
  if (body instanceof Response) return body;
  const svc = service();

  // close a request: nothing more can be added through its link
  if (body.close_id) {
    if (!UUID.test(body.close_id)) return json(400, { error: "Which request?" });
    const seen = await who.client
      .from("document_requests")
      .select("id")
      .eq("id", body.close_id)
      .maybeSingle();
    if (!seen.data) return json(404, { error: "That request isn't on a file you can see." });
    await svc
      .from("document_requests")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", body.close_id);
    return json(200, { ok: true });
  }

  // a new link for a lost one: same file and items, the old link stops working
  if (body.replace_id) {
    if (!UUID.test(body.replace_id)) return json(400, { error: "Which request?" });
    const old = await who.client
      .from("document_requests")
      .select("application_id,title,items,note")
      .eq("id", body.replace_id)
      .maybeSingle();
    const o = old.data as {
      application_id: string;
      title: string;
      items: Item[];
      note: string | null;
    } | null;
    if (!o) return json(404, { error: "That request isn't on a file you can see." });
    body.application_id = o.application_id;
    body.title = o.title;
    body.items = o.items;
    body.note = o.note ?? "";
  }

  const appId = String(body.application_id ?? "");
  if (!UUID.test(appId)) return json(400, { error: "Which file?" });
  // the caller's own rules decide whether they may work this file
  const file = await who.client.from("applications").select("id").eq("id", appId).maybeSingle();
  if (!file.data) return json(404, { error: "That file isn't one you can work." });
  const roles = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", who.userId)
    .in("role", ["admin", "rep"]);
  if (!roles.data?.length) return json(403, { error: "Only Lamp staff ask for documents." });

  const items = cleanItems(body.items);
  if (!items.length) return json(400, { error: "Tick at least one document." });
  const title = (body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Documents";
  const note = (body.note ?? "").trim().slice(0, 600) || null;
  const token = newToken();
  const seat = await svc
    .from("reps")
    .select("name")
    .eq("user_id", who.userId)
    .limit(1)
    .maybeSingle();
  const prof = seat.data
    ? null
    : await svc.from("profiles").select("full_name,email").eq("id", who.userId).maybeSingle();
  const name =
    (seat.data as { name?: string } | null)?.name ||
    (prof?.data as { full_name?: string | null; email?: string | null } | null)?.full_name ||
    (prof?.data as { email?: string | null } | null)?.email ||
    null;
  const ins = await svc
    .from("document_requests")
    .insert({
      application_id: appId,
      token_hash: await hashToken(token),
      title,
      items,
      note,
      created_by: who.userId,
      created_by_name: name,
    } as never)
    .select("id,expires_at")
    .single();
  if (ins.error || !ins.data) return json(500, { error: "Couldn't make the link. Try again." });
  if (body.replace_id)
    await svc
      .from("document_requests")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", body.replace_id);
  const made = ins.data as { id: string; expires_at: string };
  await svc.from("events").insert({
    application_id: appId,
    actor_user_id: who.userId,
    kind: "note",
    body: `Asked for documents (${title}): ${items.map((i) => i.label).join(", ")}`,
    visible_to_merchant: false,
  } as never);
  return json(200, { id: made.id, url: linkFor(token), expires_at: made.expires_at });
}

// ---------- the merchant's link ----------

type Found = {
  id: string;
  application_id: string;
  title: string;
  items: Item[];
  note: string | null;
  expires_at: string;
  closed_at: string | null;
  created_by_name: string | null;
};

async function findByToken(token: string): Promise<Found | Response> {
  if (!isToken(token))
    return json(404, { error: "This link isn't right. Ask Lamp for a new one." });
  const r = await service()
    .from("document_requests")
    .select("id,application_id,title,items,note,expires_at,closed_at,created_by_name")
    .eq("token_hash", await hashToken(token))
    .maybeSingle();
  const f = r.data as Found | null;
  if (!f) return json(404, { error: "This link isn't right. Ask Lamp for a new one." });
  if (f.closed_at)
    return json(410, {
      error: "This link was closed. Ask Lamp for a new one if you still need to send something.",
    });
  if (Date.parse(f.expires_at) < Date.now())
    return json(410, { error: "This link has expired. Ask Lamp for a new one." });
  return f;
}

/** GET: what's asked, who asked (the name the merchant knows), and what they've sent so far. */
export async function documentRequestInfo(request: Request): Promise<Response> {
  const nr = ready();
  if (nr) return nr;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const f = await findByToken(token);
  if (f instanceof Response) return f;
  const svc = service();
  const app = await svc
    .from("applications")
    .select("first_name,business_name,rep_slug")
    .eq("id", f.application_id)
    .maybeSingle();
  const a = app.data as {
    first_name: string | null;
    business_name: string | null;
    rep_slug: string | null;
  } | null;
  // the name the merchant knows: a team rep's admin, else the rep (as on their application)
  let from = "Lamp";
  if (a?.rep_slug) {
    const rep = await svc
      .from("reps")
      .select("name,admin_slug")
      .eq("slug", a.rep_slug)
      .maybeSingle();
    const r = rep.data as { name: string; admin_slug: string | null } | null;
    if (r?.admin_slug) {
      const lead = await svc
        .from("reps")
        .select("name,active")
        .eq("slug", r.admin_slug)
        .maybeSingle();
      const l = lead.data as { name: string; active: boolean } | null;
      from = l?.active ? l.name : r.name;
    } else if (r) from = r.name;
  }
  const got = await svc
    .from("documents")
    .select("original_name,kind,created_at")
    .eq("request_id", f.id)
    .order("created_at");
  return json(200, {
    first_name: a?.first_name ?? null,
    business_name: a?.business_name ?? null,
    from,
    items: f.items,
    note: f.note,
    expires_at: f.expires_at,
    received: (
      (got.data ?? []) as { original_name: string; kind: string; created_at: string }[]
    ).map((d) => ({
      name: d.original_name,
      kind: d.kind,
      at: d.created_at,
    })),
  });
}

/** POST (multipart: token, item, file): one file for one asked-for item. */
export async function documentRequestUpload(request: Request): Promise<Response> {
  const nr = ready();
  if (nr) return nr;
  let buf: Uint8Array<ArrayBuffer> | null;
  try {
    buf = await readCapped(request, MAX_UPLOAD_BYTES + 64 * 1024);
  } catch {
    return json(400, { error: "Send the file as a form." });
  }
  if (!buf) return json(413, { error: "That file is over 20 MB." });
  let form: FormData;
  try {
    form = await new Response(buf, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return json(400, { error: "Send the file as a form." });
  }
  const f = await findByToken(String(form.get("token") ?? ""));
  if (f instanceof Response) return f;
  const key = String(form.get("item") ?? "");
  const item = f.items.find((i) => i.key === key);
  const file = form.get("file");
  if (!item || !(file instanceof File))
    return json(400, { error: "Choose which document this is." });
  if (file.size > MAX_UPLOAD_BYTES) return json(413, { error: "That file is over 20 MB." });
  const type = uploadType(file);
  if (!UPLOAD_TYPES.includes(type))
    return json(415, { error: "Send a PDF or a photo (JPG, PNG or HEIC)." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (type === "application/pdf" && !looksLikePdf(bytes))
    return json(415, { error: "That file isn't a PDF we can open. Send a PDF or a photo." });

  const svc = service();
  const count = await svc
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("request_id", f.id);
  if ((count.count ?? 0) >= MAX_FILES)
    return json(429, {
      error: "That's the most files this link takes. Ask Lamp for another link.",
    });

  const safe =
    file.name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "file";
  const path = `request/${f.application_id}/${f.id}/${Date.now()}-${safe}`;
  const up = await svc.storage
    .from("documents")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) return json(500, { error: "Couldn't store the file. Try again." });
  const kind = docItem(item.key).kind;
  const idx = await svc.from("documents").insert({
    application_id: f.application_id,
    user_id: null,
    bucket: "documents",
    storage_path: path,
    kind,
    original_name: file.name.slice(0, 200),
    size_bytes: bytes.length,
    mime_type: type,
    request_id: f.id,
  } as never);
  if (idx.error) {
    await svc.storage.from("documents").remove([path]);
    return json(500, { error: "Couldn't store the file. Try again." });
  }
  await svc.from("events").insert({
    application_id: f.application_id,
    kind: "document_uploaded",
    body: `${item.label} added from the documents link (${f.title}): ${file.name.slice(0, 120)}`,
    visible_to_merchant: true,
  } as never);
  return json(200, { ok: true });
}
