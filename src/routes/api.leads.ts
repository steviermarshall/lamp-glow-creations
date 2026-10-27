import { createFileRoute } from "@tanstack/react-router";

// POST: the lead form's email step, so unfinished sign-ups aren't lost. Allowed fields only, and a
// per-network limit.
export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { submitLead } = await import("@/lib/leads.server");
        return submitLead(request);
      },
    },
  },
});
