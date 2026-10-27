import { createFileRoute } from "@tanstack/react-router";
import { findRep, seo } from "@/lib/site";
import { ChangeApplication } from "@/components/application/change-application";

// The update link from "Send back for changes": getlamp.app/application/<rep>/changes#c=<token>.
// The token is in the fragment, read by the page and never sent to the server with the page.
export const Route = createFileRoute("/application/$rep_/changes")({
  head: ({ params }) => {
    const rep = findRep(params.rep);
    return seo({
      path: `/application/${params.rep}/changes`,
      title: rep
        ? `Update your application with ${rep.name} — Lamp`
        : "Update your application — Lamp",
      description: "Add what your Lamp rep asked for and sign your application again.",
      noindex: true,
    });
  },
  component: Changes,
});

function Changes() {
  const { rep } = Route.useParams();
  return <ChangeApplication repSlug={rep.toLowerCase()} />;
}
