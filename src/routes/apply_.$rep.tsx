import { createFileRoute } from "@tanstack/react-router";
import { findRep, seo } from "@/lib/site";
import { ApplyFlow } from "@/components/site/apply-flow";

// Rep links, e.g. getlamp.app/apply/zeus. Same flow as /apply; the application is tagged
// ref=<slug> so it lands with that rep. An unknown slug still gets the normal flow.
export const Route = createFileRoute("/apply_/$rep")({
  validateSearch: (search: Record<string, unknown>) => search as Record<string, string | undefined>,
  head: ({ params }) => {
    const rep = findRep(params.rep);
    return seo({
      path: "/apply",
      title: rep ? `Check your options with ${rep.name} — Lamp` : "Check your options — Lamp",
      description:
        "Answer a few quick questions to see what your business could qualify for. About a minute, and no effect on your credit.",
      noindex: true,
    });
  },
  component: RepApply,
});

function RepApply() {
  const { rep } = Route.useParams();
  const found = findRep(rep);
  return <ApplyFlow search={Route.useSearch()} {...(found ? { rep: found } : {})} />;
}
