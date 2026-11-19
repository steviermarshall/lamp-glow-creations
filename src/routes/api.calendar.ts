import { createFileRoute } from "@tanstack/react-router";

// GET: the signed-in staff member's calendar, after Lamp's rules have run (calendar.server.ts).
export const Route = createFileRoute("/api/calendar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { calendarGet } = await import("@/lib/calendar.server");
        return calendarGet(request);
      },
    },
  },
});
