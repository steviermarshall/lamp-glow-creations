import { createFileRoute } from "@tanstack/react-router";

// POST: the application page asks who sent the link and what's already known, and the visit is
// recorded on the link (opened, then started).
export const Route = createFileRoute("/api/application/open")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { openApplication } = await import("@/lib/application-links.server");
        return openApplication(request);
      },
    },
  },
});
