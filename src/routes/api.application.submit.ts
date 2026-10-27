import { createFileRoute } from "@tanstack/react-router";

// POST: the merchant signs and submits the full application from a link. The file lands with the
// rep the link belongs to, with no account needed first.
export const Route = createFileRoute("/api/application/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { submitApplication } = await import("@/lib/application-links.server");
        return submitApplication(request);
      },
    },
  },
});
