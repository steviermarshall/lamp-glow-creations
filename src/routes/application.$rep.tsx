import { createFileRoute } from "@tanstack/react-router";
import { findRep, seo } from "@/lib/site";
import { isToken } from "@/lib/application-links";
import { carriedSearch, quickFromParams } from "@/lib/apply";
import { PageShell } from "@/components/site/layout";
import { LinkApplication } from "@/components/application/link-application";

// The full application from a link. getlamp.app/application/<rep>?i=<token> is a personal link a
// rep sent (their details filled in, tracked as opened and started); getlamp.app/application/<rep>
// is the rep's public link (quick answers and utm_ tags in the link are kept, as on the website's
// /application). Either way the signed file lands with that rep.
export const Route = createFileRoute("/application/$rep")({
  // fill=rep: a rep filling it in with the merchant on the phone (Start application)
  validateSearch: (
    s: Record<string, unknown>,
  ): Record<string, string | undefined> & { i?: string | undefined; fill?: "rep" | undefined } => ({
    ...carriedSearch(s),
    i: isToken(s["i"]) ? s["i"] : undefined,
    fill: s["fill"] === "rep" ? "rep" : undefined,
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
  const search = Route.useSearch();
  const { i, fill } = search;
  // the page shell is the route's, so the server's HTML preloads its code with the route
  return (
    <PageShell member themeToggle={false} minimalHeader footer={false} tone="night">
      <LinkApplication
        repSlug={rep.toLowerCase()}
        token={i ?? null}
        filling={fill === "rep"}
        prefill={i ? {} : quickFromParams(search)}
        carried={i ? {} : carriedSearch(search)}
      />
    </PageShell>
  );
}
