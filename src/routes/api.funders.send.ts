import { createFileRoute } from "@tanstack/react-router";

// POST: send a file to its matched funders (staff session, or the shared secret for automatic
// sends). GET: which sending settings are present, yes or no only, for the Funders page.
export const Route = createFileRoute("/api/funders/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { sendToFunders } = await import("@/lib/funder-send.server");
        return sendToFunders(request);
      },
      GET: async () => {
        const { sendingConfigured } = await import("@/lib/funder-send.server");
        return Response.json(sendingConfigured(), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
