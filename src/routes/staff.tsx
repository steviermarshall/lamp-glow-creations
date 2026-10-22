import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { seo } from "@/lib/site";
import { isStage, useStaffAccess, type Stage } from "@/lib/staff";
import { PageShell } from "@/components/site/layout";
import { Board } from "@/components/staff/board";
import { FileView } from "@/components/staff/file-view";

type StaffSearch = {
  stage?: Stage | undefined;
  rep?: string | undefined;
  file?: string | undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const Route = createFileRoute("/staff")({
  validateSearch: (s: Record<string, unknown>): StaffSearch => ({
    stage: isStage(s["stage"]) ? s["stage"] : undefined,
    rep:
      typeof s["rep"] === "string" && (s["rep"] === "unassigned" || SLUG.test(s["rep"]))
        ? s["rep"]
        : undefined,
    file: typeof s["file"] === "string" && UUID.test(s["file"]) ? s["file"] : undefined,
  }),
  head: () =>
    seo({
      path: "/staff",
      title: "Staff — Lamp",
      description: "Lamp staff files.",
      noindex: true,
    }),
  component: Staff,
});

function Staff() {
  const { user, loading } = useAuth();
  const access = useStaffAccess(user?.id ?? null, loading);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/staff" });
  const [reps, setReps] = useState<{ slug: string; name: string }[]>([]);

  const isStaff = access.state === "staff";
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isStaff) return;
    sb.from("reps")
      .select("slug,name")
      .order("name")
      .then(({ data }) => setReps(data ?? []));
  }, [isStaff]);

  if (access.state === "loading") {
    return (
      <PageShell footer={false}>
        <div className="grid place-items-center py-40">
          <Loader2 className="size-6 animate-spin text-smoke" />
        </div>
      </PageShell>
    );
  }

  if (access.state !== "staff") {
    return (
      <PageShell footer={false}>
        <div className="mx-auto max-w-xl px-5 py-24 text-center" data-staff-gate={access.state}>
          <h1 className="font-display text-2xl font-bold">Staff only</h1>
          <p className="mt-2 text-smoke">
            {access.state === "error" ? access.message : "This page is for the Lamp team."}
          </p>
          {access.state === "signed_out" && (
            <Link to="/login" className="mt-6 inline-block font-semibold text-amber-deep">
              Sign in
            </Link>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell footer={false}>
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-6 sm:pt-14">
        <p className="text-sm text-smoke">
          {user?.email} · {access.isAdmin ? "Admin" : "Rep"}
          {access.repSlug && ` · /${access.repSlug}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">Files</h1>
        {search.file ? (
          <FileView
            fileId={search.file}
            userId={access.userId}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : (
          <Board
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            stage={search.stage}
            rep={access.isAdmin ? (search.rep ?? "all") : "all"}
            reps={reps}
            onStage={(stage) => navigate({ search: (s) => ({ ...s, stage }) })}
            onRep={(rep) =>
              navigate({ search: (s) => ({ ...s, rep: rep === "all" ? undefined : rep }) })
            }
          />
        )}
      </div>
    </PageShell>
  );
}
