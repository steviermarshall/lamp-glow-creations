import { createFileRoute } from "@tanstack/react-router";

// POST: the merchant's side of "Send back for changes". "open" checks an update link (and, with
// their date of birth, returns the answers to update); "submit" signs the update, from the link
// or from their account.
export const Route = createFileRoute("/api/application/changes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { changeApplication } = await import("@/lib/application-changes.server");
        return changeApplication(request);
      },
    },
  },
});
