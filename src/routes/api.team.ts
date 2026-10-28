import { createFileRoute } from "@tanstack/react-router";

// GET: the team (reps, their admin, login and invite state). POST: add, update or re-invite a
// rep. Admins only; see team.server.ts.
export const Route = createFileRoute("/api/team")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { listTeam } = await import("@/lib/team.server");
        return listTeam(request);
      },
      POST: async ({ request }) => {
        const { changeTeam } = await import("@/lib/team.server");
        return changeTeam(request);
      },
    },
  },
});
