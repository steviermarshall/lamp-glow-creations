import { createFileRoute } from "@tanstack/react-router";

// POST: a signed-in person's sign-in or staff action, for the activity log.
export const Route = createFileRoute("/api/activity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { recordActivity } = await import("@/lib/tracking.server");
        return recordActivity(request);
      },
    },
  },
});
