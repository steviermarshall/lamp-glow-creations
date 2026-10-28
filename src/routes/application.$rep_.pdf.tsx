import { createFileRoute } from "@tanstack/react-router";
import { findRep, seo } from "@/lib/site";
import { PaperApplication } from "@/components/application/paper-application";

// The rep's PDF link, e.g. getlamp.app/application/zeus/pdf: the whole one-page application in
// front of the merchant, filled in and signed on the page. The B side of an A/B test against the
// step-by-step application at /application/<rep>; both land in the rep's files the same way.
export const Route = createFileRoute("/application/$rep_/pdf")({
  head: ({ params }) => {
    const rep = findRep(params.rep);
    return seo({
      path: `/application/${params.rep}/pdf`,
      title: rep ? `Your application with ${rep.name} — Lamp` : "Your application — Lamp",
      description: "The Lamp working capital application on one page: fill it in and sign it here.",
      noindex: true,
    });
  },
  component: Paper,
});

function Paper() {
  const { rep } = Route.useParams();
  return <PaperApplication repSlug={rep.toLowerCase()} />;
}
