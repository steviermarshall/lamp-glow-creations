import { createFileRoute } from "@tanstack/react-router";

// GET: when each file the signed-in staff member can see was signed (for the Dashboard).
export const Route = createFileRoute("/api/staff/signed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { signedFiles } = await import("@/lib/signed.server");
        return signedFiles(request);
      },
    },
  },
});
