import { createFileRoute } from "@tanstack/react-router";

// POST: a signed-in merchant adds a file to their own application (account page, or the signed
// copy after signing there). PDFs and photos only, checked on the server.
export const Route = createFileRoute("/api/documents/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { uploadDocument } = await import("@/lib/documents.server");
        return uploadDocument(request);
      },
    },
  },
});
