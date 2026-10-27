import { createFileRoute } from "@tanstack/react-router";

// POST: bank statements added right after signing, from the browser that submitted, before the
// merchant has an account.
export const Route = createFileRoute("/api/application/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { uploadToApplication } = await import("@/lib/application-links.server");
        return uploadToApplication(request);
      },
    },
  },
});
