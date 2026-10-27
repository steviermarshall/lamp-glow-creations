import { createFileRoute } from "@tanstack/react-router";

// POST: staff send personal application links (email from Lamp's mailbox, or a link to copy),
// make a new link for one, or stop one. Signed-in staff only; the database rules decide which
// leads and links each person reaches.
export const Route = createFileRoute("/api/application-invites")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { applicationInvites } = await import("@/lib/application-links.server");
        return applicationInvites(request);
      },
    },
  },
});
