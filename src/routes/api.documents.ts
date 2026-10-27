import { createFileRoute } from "@tanstack/react-router";

// POST: the merchant's own folder, removing one of their files, and opening (logged) or reviewing
// a document. The browser never reaches the documents bucket itself; the database rules still
// decide what each person reaches.
export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { documentsAction } = await import("@/lib/documents.server");
        return documentsAction(request);
      },
    },
  },
});
