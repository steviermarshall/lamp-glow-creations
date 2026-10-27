// Server side of documents: bank statements, IDs and the signed application, for merchants on
// their account page and staff on a file. The browser no longer touches the documents bucket or
// writes documents rows itself; once the switch in 20261027190000_server_stamp.sql is on, the
// database refuses it. Everything here runs as the signed-in caller with the server's stamp, so
// the existing per-person rules on documents and on the bucket still decide what each one reaches.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { caller, json } from "@/lib/funder-send.server";
import { looksLikePdf, readCapped, readJson, uploadType } from "@/lib/application-links.server";
import { MAX_SIGNED_PDF_BYTES, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "@/lib/application-links";
import {
  isDocumentKind,
  type DocumentOutcome,
  type DocumentsRequest,
  type FolderFile,
} from "@/lib/documents";

const BUCKET = "documents";
const SIGNED_URL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Who = NonNullable<Awaited<ReturnType<typeof caller>>>;

const docName = (d: { original_name: string | null; storage_path: string }) =>
  d.original_name || d.storage_path.slice(d.storage_path.lastIndexOf("/") + 1).replace(/^\d+-/, "");

/** POST /api/documents: the merchant's folder, removing one of their files, opening, reviewing. */
export async function documentsAction(request: Request): Promise<Response> {
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const body = await readJson<DocumentsRequest>(request, 4 * 1024);
  if (body instanceof Response) return body;
  switch (body.action) {
    case "folder":
      return folder(who);
    case "remove":
      return remove(who, String(body.path ?? ""));
    case "open":
      return open(who, String(body.document_id ?? ""));
    case "review":
      return review(who, String(body.document_id ?? ""), body.status);
    default:
      return json(400, { error: "Unknown action." });
  }
}

/** The files in the caller's own folder, so the account page can show ones no row points at. */
async function folder(who: Who): Promise<Response> {
  const r = await who.client.storage
    .from(BUCKET)
    .list(who.userId, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (r.error) return json(500, { error: "Couldn't load your files." });
  const files: FolderFile[] = r.data
    .filter((f) => f.name !== ".emptyFolderPlaceholder")
    .map((f) => ({ name: f.name, created_at: f.created_at ?? null }));
  return json(200, { files });
}

/**
 * Remove one of the caller's own files. The row goes first; the database lets the file go only once
 * no row points at it, and keeps the row once the file has gone to funders.
 */
async function remove(who: Who, path: string): Promise<Response> {
  if (!path.startsWith(`${who.userId}/`) || path.includes("..") || path.length > 300)
    return json(400, { error: "That isn't one of your files." });
  const del = await who.client
    .from("documents")
    .delete()
    .eq("bucket", BUCKET)
    .eq("storage_path", path)
    .select("id");
  if (del.error) return json(200, { outcome: "failed" satisfies DocumentOutcome });
  if (!del.data.length) {
    const still = await who.client
      .from("documents")
      .select("id")
      .eq("bucket", BUCKET)
      .eq("storage_path", path)
      .maybeSingle();
    if (still.error) return json(200, { outcome: "failed" satisfies DocumentOutcome });
    if (still.data) return json(200, { outcome: "kept" satisfies DocumentOutcome });
  }
  const rm = await who.client.storage.from(BUCKET).remove([path]);
  return json(200, { outcome: (rm.error ? "failed" : "removed") satisfies DocumentOutcome });
}

/**
 * A 60-second link to one document, for whoever may read its row. open_document() writes who
 * opened which file to sensitive_access_log first, and the bucket's own rules sign the link.
 */
async function open(who: Who, id: string): Promise<Response> {
  if (!UUID.test(id)) return json(400, { error: "document_id is required." });
  const row = await who.client
    .from("documents")
    .select("id,bucket,storage_path")
    .eq("id", id)
    .maybeSingle();
  if (row.error) return json(500, { error: "Couldn't open that document." });
  if (!row.data) return json(404, { error: "We couldn't find that document." });
  const logged = await who.client.rpc("open_document" as never, { _document_id: id } as never);
  if (logged.error) {
    const denied = logged.error.code === "42501";
    return json(denied ? 403 : 500, {
      error: denied ? "That document isn't yours to open." : "Couldn't open that document.",
    });
  }
  const signed = await who.client.storage
    .from(row.data.bucket || BUCKET)
    .createSignedUrl(row.data.storage_path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) return json(500, { error: "Couldn't open that document." });
  return json(200, { url: signed.data.signedUrl });
}

/** Staff accept or turn down a document; the review goes on the file's timeline as the reviewer. */
async function review(who: Who, id: string, status: unknown): Promise<Response> {
  if (!UUID.test(id) || (status !== "accepted" && status !== "rejected"))
    return json(400, { error: "document_id and an accepted or rejected status are required." });
  const up = await who.client
    .from("documents")
    .update({ status, reviewed_by: who.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select("id,application_id,original_name,storage_path");
  // an update the rules refuse comes back with no rows, not an error
  if (up.error || up.data.length !== 1)
    return json(403, { error: "That change wasn't saved. You may not have access to this file." });
  const d = up.data[0]!;
  // the document table has no timeline trigger, so the review is logged here, as the reviewer
  await who.client.from("events").insert({
    application_id: d.application_id,
    actor_user_id: who.userId,
    kind: "document_reviewed",
    body: `${status === "accepted" ? "Accepted" : "Not accepted"}: ${docName(d)}`,
    payload: { document_id: d.id, status },
  });
  return json(200, { ok: true });
}

/**
 * POST /api/documents/upload, a form with application_id, kind and file: a merchant adds a file to
 * their own application, from the account page or as the signed copy after signing there. PDFs and
 * photos only (JPG, PNG, HEIC), checked here, up to 20 MB (8 MB for the signed copy). Answers
 * { outcome }: "saved", "failed" (nothing left behind) or "unknown" when the result could not be
 * confirmed (the list after the upload shows the truth).
 */
export async function uploadDocument(request: Request): Promise<Response> {
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
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
  const appId = String(form.get("application_id") ?? "");
  const kind = form.get("kind");
  const file = form.get("file");
  if (!UUID.test(appId) || !isDocumentKind(kind) || !(file instanceof File))
    return json(400, { error: "Missing the file or the application." });
  const signedCopy = kind === "funder_application" && form.get("signed_copy") === "1";
  if (file.size > (signedCopy ? MAX_SIGNED_PDF_BYTES : MAX_UPLOAD_BYTES))
    return json(413, { error: signedCopy ? "That PDF is too large." : "That file is over 20 MB." });
  const type = uploadType(file);
  if (signedCopy ? type !== "application/pdf" : !UPLOAD_TYPES.includes(type))
    return json(415, { error: "Send a PDF or a photo (JPG, PNG or HEIC)." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (type === "application/pdf" && !looksLikePdf(bytes))
    return json(415, { error: "That file isn't a PDF we can open. Send a PDF or a photo." });

  // the caller's own application, as the rules let them read it
  const app = await who.client
    .from("applications")
    .select("id")
    .eq("id", appId)
    .eq("user_id", who.userId)
    .maybeSingle();
  if (app.error) return json(500, { error: "Couldn't store the file. Try again." });
  if (!app.data) return json(404, { error: "We couldn't find that application." });

  const path = signedCopy
    ? `${who.userId}/${Date.now()}-signed-application.pdf`
    : `${who.userId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "file"}`;
  const up = await who.client.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) return json(200, { outcome: "failed" satisfies DocumentOutcome });
  const idx = await who.client.from("documents").insert({
    application_id: appId,
    user_id: who.userId,
    bucket: BUCKET,
    storage_path: path,
    kind,
    original_name: signedCopy ? "Signed application.pdf" : file.name.slice(0, 200),
    size_bytes: bytes.length,
    mime_type: type,
  });
  if (!idx.error) return json(200, { outcome: "saved" satisfies DocumentOutcome });
  // the row may have been written even though the reply was lost: then it worked
  const row = await who.client
    .from("documents")
    .select("id")
    .eq("bucket", BUCKET)
    .eq("storage_path", path)
    .maybeSingle();
  if (row.error) return json(200, { outcome: "unknown" satisfies DocumentOutcome });
  if (row.data) return json(200, { outcome: "saved" satisfies DocumentOutcome });
  // no row points at the file, so the database lets it go
  await who.client.storage.from(BUCKET).remove([path]);
  return json(200, { outcome: "failed" satisfies DocumentOutcome });
}
