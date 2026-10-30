import { createFileRoute } from "@tanstack/react-router";

// GET: the signed-in staff member's Today list (?file=<id> for one file's next step).
export const Route = createFileRoute("/api/brain/brief")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { brainBrief } = await import("@/lib/brain.server");
        return brainBrief(request);
      },
    },
  },
});
