import { createFileRoute } from "@tanstack/react-router";

// POST: the application link's first screen (name, phone, email). Saved as a lead with the rep,
// who is emailed at once with Asad and Stevie copied.
export const Route = createFileRoute("/api/application/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { startApplication } = await import("@/lib/application-start.server");
        return startApplication(request);
      },
    },
  },
});
