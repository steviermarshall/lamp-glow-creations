import { createFileRoute } from "@tanstack/react-router";

// POST: staff read a file's full application, masked, or with the full numbers for a logged
// purpose (Show SSN, the PDF, a funder send). Admins and the assigned rep only.
export const Route = createFileRoute("/api/application-details")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { fullApplication } = await import("@/lib/full-application.server");
        return fullApplication(request);
      },
    },
  },
});
