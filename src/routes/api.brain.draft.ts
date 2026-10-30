import { createFileRoute } from "@tanstack/react-router";

// POST: a follow-up draft (text, email, call notes) for one Today item, or log that it was sent.
export const Route = createFileRoute("/api/brain/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { brainDraft } = await import("@/lib/drafts.server");
        return brainDraft(request);
      },
    },
  },
});
