import { createFileRoute } from "@tanstack/react-router";

// The War Room engine's nightly read-back, with the shared secret: GET what reps did with the
// engine's leads since a date (see src/lib/engine-outcomes.server.ts). Changes nothing.
export const Route = createFileRoute("/api/engine/outcomes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readOutcomes } = await import("@/lib/engine-outcomes.server");
        return readOutcomes(request);
      },
    },
  },
});
