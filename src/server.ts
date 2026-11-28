import "./lib/error-capture.ts";

import { consumeLastCapturedError } from "./lib/error-capture.ts";
import { renderErrorPage } from "./lib/error-page.ts";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Security headers for every response the server sends (pages, server functions, API routes and
// the error page). The host already adds strict-transport-security, nosniff and referrer-policy,
// but nothing stopped another site from framing Lamp: no content-security-policy, x-frame-options
// or permissions-policy. A header is only filled in when the response doesn't already carry it.
// No script-src: the root head uses inline scripts and the host injects its own script.
// HSTS stays with the host, which already sends it, so the two can't disagree.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Nothing in Lamp uses the camera, microphone, location or the Payment Request API.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

// Only Lovable's editor may frame the page, and only when it is served from a Lovable preview
// address. getlamp.app can be framed by Lamp itself and nobody else. The preview zones and the
// editor origins are the same ones src/integrations/supabase/previewAuthStorage.ts (written by
// Lovable) trusts: previews on lovableproject.com, lovableproject-dev.com, lovable.app,
// gpt-eng.com and gptengineer.run, and the editor on lovable.dev or gptengineer.app.
const LOVABLE_PREVIEW_HOST =
  /\.(lovable\.app|lovableproject\.com|lovableproject-dev\.com|gpt-eng\.com|gptengineer\.run)$/;
const LOVABLE_EDITOR_ORIGINS = [
  "https://lovable.dev",
  "https://*.lovable.dev",
  "https://gptengineer.app",
  "https://*.gptengineer.app",
];

function requestHost(request: Request): string {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    // An unreadable address gets the strict policy.
    return "";
  }
}

export function isLovablePreview(request: Request): boolean {
  return LOVABLE_PREVIEW_HOST.test(requestHost(request));
}

export function contentSecurityPolicy(request: Request): string {
  const ancestors = isLovablePreview(request)
    ? ["'self'", ...LOVABLE_EDITOR_ORIGINS].join(" ")
    : "'self'";
  return `frame-ancestors ${ancestors}; base-uri 'self'; object-src 'none'`;
}

export function withSecurityHeaders(response: Response, request: Request): Response {
  const wanted: Record<string, string> = {
    ...SECURITY_HEADERS,
    "content-security-policy": contentSecurityPolicy(request),
  };
  // Older browsers ignore frame-ancestors. x-frame-options has no way to allow lovable.dev, so it
  // is left off preview addresses, or the Lovable editor preview would go blank.
  if (!isLovablePreview(request)) wanted["x-frame-options"] = "SAMEORIGIN";

  const missing = Object.entries(wanted).filter(([name]) => !response.headers.has(name));
  if (!missing.length) return response;
  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    // Some responses (redirects, fetched responses) have headers that can't be changed; copy
    // into a new one. If even that isn't allowed, send the response as it was.
    const headers = new Headers(response.headers);
    for (const [name, value] of missing) headers.set(name, value);
    try {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// The server, given how to load TanStack Start's handler. Tests pass a stub handler.
export function createServer(loadEntry: () => Promise<ServerEntry>): ServerEntry {
  return {
    async fetch(request: Request, env: unknown, ctx: unknown) {
      try {
        const handler = await loadEntry();
        const response = await handler.fetch(request, env, ctx);
        return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request);
      } catch (error) {
        console.error(error);
        return withSecurityHeaders(
          new Response(renderErrorPage(), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
          request,
        );
      }
    },
  };
}

export default createServer(getServerEntry);
