import { createFileRoute } from "@tanstack/react-router";

// POST: how far someone got on a rep's public application link (no login); always 204.
export const Route = createFileRoute("/api/application/progress")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { recordProgress } = await import("@/lib/application-start.server");
        return recordProgress(request);
      },
    },
  },
});
