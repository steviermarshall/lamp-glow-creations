import { createFileRoute } from "@tanstack/react-router";

// POST (multipart: token, item, file): one file from the merchant's documents link.
export const Route = createFileRoute("/api/documents/request-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { documentRequestUpload } = await import("@/lib/document-requests.server");
        return documentRequestUpload(request);
      },
    },
  },
});
