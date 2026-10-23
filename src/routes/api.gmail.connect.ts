import { createFileRoute } from "@tanstack/react-router";

// POST: an admin asks for Google's consent URL to connect the sending mailbox.
export const Route = createFileRoute("/api/gmail/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { gmailConnectStart } = await import("@/lib/funder-send.server");
        return gmailConnectStart(request);
      },
    },
  },
});
