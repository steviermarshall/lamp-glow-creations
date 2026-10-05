import { createFileRoute } from "@tanstack/react-router";
import { seo } from "@/lib/site";
import { ApplyFlow } from "@/components/site/apply-flow";

export const Route = createFileRoute("/apply")({
  validateSearch: (search: Record<string, unknown>) => search as Record<string, string | undefined>,
  head: () =>
    seo({
      path: "/apply",
      title: "Check your options — Lamp",
      description:
        "Answer a few quick questions to see what your business could qualify for. About a minute, and no effect on your credit.",
    }),
  component: Apply,
});

function Apply() {
  return <ApplyFlow search={Route.useSearch()} />;
}
