import { createFileRoute } from "@tanstack/react-router";

// GET: Google returns here after the mailbox owner allows sending. Stores the refresh token
// server side and sends the admin back to the Funders page.
export const Route = createFileRoute("/api/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { gmailCallback } = await import("@/lib/funder-send.server");
        return gmailCallback(request);
      },
    },
  },
});
