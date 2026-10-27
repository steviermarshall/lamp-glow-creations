import { createFileRoute } from "@tanstack/react-router";

// POST: a page view or an /apply step from any visitor (no login); always 204.
export const Route = createFileRoute("/api/track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { recordSiteEvent } = await import("@/lib/tracking.server");
        return recordSiteEvent(request);
      },
    },
  },
});
