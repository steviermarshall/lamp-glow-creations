import { createFileRoute } from "@tanstack/react-router";
import { BLANK_APPLICATION_PDF } from "@/lib/application-links";

// The rep's PDF link, e.g. getlamp.app/application/zeus/pdf: the whole application on one
// fillable page, opened in the browser's PDF viewer, to type into, print or save. It's the B side
// of an A/B test against the online application at /application/<rep>; the open is counted as a
// page view of this path, so Dashboard → Website → Page lists the two links side by side.
export const Route = createFileRoute("/application/$rep_/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { recordPdfOpen } = await import("@/lib/tracking.server");
        await recordPdfOpen(request, params.rep.toLowerCase());
        return new Response(null, {
          status: 302,
          headers: { Location: BLANK_APPLICATION_PDF, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
