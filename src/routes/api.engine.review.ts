import { createFileRoute } from "@tanstack/react-router";

// Staff > Email engine, for admins: GET the emails waiting for approval; POST to send, leave out,
// put back or retry them (see src/lib/engine-outbox.server.ts). Signed-in admins only.
export const Route = createFileRoute("/api/engine/review")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { reviewGet } = await import("@/lib/engine-outbox.server");
        return reviewGet(request);
      },
      POST: async ({ request }) => {
        const { reviewPost } = await import("@/lib/engine-outbox.server");
        return reviewPost(request);
      },
    },
  },
});
