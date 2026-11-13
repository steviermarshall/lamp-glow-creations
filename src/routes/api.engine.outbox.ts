import { createFileRoute } from "@tanstack/react-router";

// The War Room email engine: POST the day's emails for approval and what happened to them; GET the
// ones an admin approved. Shared secret only (see src/lib/engine-outbox.server.ts).
export const Route = createFileRoute("/api/engine/outbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { engineOutboxPost } = await import("@/lib/engine-outbox.server");
        return engineOutboxPost(request);
      },
      GET: async ({ request }) => {
        const { engineOutboxGet } = await import("@/lib/engine-outbox.server");
        return engineOutboxGet(request);
      },
    },
  },
});
