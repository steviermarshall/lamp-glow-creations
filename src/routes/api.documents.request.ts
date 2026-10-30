import { createFileRoute } from "@tanstack/react-router";

// GET ?token=: the merchant's documents link (what's asked, what came in).
// POST: staff make a request (or replace a lost link, or close one) and get the link back.
export const Route = createFileRoute("/api/documents/request")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { documentRequestInfo } = await import("@/lib/document-requests.server");
        return documentRequestInfo(request);
      },
      POST: async ({ request }) => {
        const { createDocumentRequest } = await import("@/lib/document-requests.server");
        return createDocumentRequest(request);
      },
    },
  },
});
