import { createFileRoute } from "@tanstack/react-router";

// GET: whether the database sees this server's stamp, yes or no only, and whether the switch that
// makes it refuse the browser is on (20261027190000_server_stamp.sql). Checked before switching on.
export const Route = createFileRoute("/api/server-check")({
  server: {
    handlers: {
      GET: async () => {
        const { stampStatus } = await import("@/lib/funder-send.server");
        return Response.json(await stampStatus(), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
