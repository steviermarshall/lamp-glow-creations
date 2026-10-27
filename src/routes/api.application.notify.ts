import { createFileRoute } from "@tanstack/react-router";

// POST: once the signed copy and the statements are uploaded, email the rep (with Asad and
// Stevie copied) the details and the files, the way Tip Top's system does.
export const Route = createFileRoute("/api/application/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { notifyNewApplication } = await import("@/lib/application-links.server");
        return notifyNewApplication(request);
      },
    },
  },
});
