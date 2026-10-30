import { createFileRoute } from "@tanstack/react-router";
import { seo } from "@/lib/site";
import { DocumentDrop } from "@/components/application/document-drop";

// A documents link, e.g. getlamp.app/upload/<secret>: the merchant drops the files Lamp asked for
// (voided check, ID, statements...) without signing in. See document-requests.server.ts.
export const Route = createFileRoute("/upload/$token")({
  head: () =>
    seo({
      path: "/upload",
      title: "Send your documents — Lamp",
      description: "Send Lamp the documents it asked for.",
      noindex: true,
    }),
  component: Upload,
});

function Upload() {
  const { token } = Route.useParams();
  return <DocumentDrop token={token} />;
}
