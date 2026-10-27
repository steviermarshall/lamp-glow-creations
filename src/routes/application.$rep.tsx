import { createFileRoute } from "@tanstack/react-router";
import { findRep, seo } from "@/lib/site";
import { isToken } from "@/lib/application-links";
import { LinkApplication } from "@/components/application/link-application";

// The full application from a link. getlamp.app/application/<rep>?i=<token> is a personal link a
// rep sent (their details filled in, tracked as opened and started); getlamp.app/application/<rep>
// is the rep's public link. Either way the signed file lands with that rep.
export const Route = createFileRoute("/application/$rep")({
  validateSearch: (s: Record<string, unknown>): { i?: string | undefined } => ({
    i: isToken(s["i"]) ? s["i"] : undefined,
  }),
  head: ({ params }) => {
    const rep = findRep(params.rep);
    return seo({
      path: `/application/${params.rep}`,
      title: rep ? `Your application with ${rep.name} — Lamp` : "Your application — Lamp",
      description:
        "Complete and sign your Lamp working capital application in about ten minutes, on your phone or computer.",
      noindex: true,
    });
  },
  component: Application,
});

function Application() {
  const { rep } = Route.useParams();
  const { i } = Route.useSearch();
  return <LinkApplication repSlug={rep.toLowerCase()} token={i ?? null} />;
}
