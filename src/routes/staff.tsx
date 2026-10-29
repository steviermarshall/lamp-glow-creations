import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { markStaffBrowser } from "@/lib/track";
import { useAuth } from "@/hooks/use-auth";
import { seo } from "@/lib/site";
import { isStage, useStaffAccess, type Stage } from "@/lib/staff";
import { PageShell } from "@/components/site/layout";
import { Board } from "@/components/staff/board";
import { FileView } from "@/components/staff/file-view";
import { EngineLeads } from "@/components/staff/engine-leads";
import { MyCalls } from "@/components/staff/notes-calls";
import { SentApplications } from "@/components/staff/sent-applications";
import { Funders } from "@/components/staff/funders";
import { Money } from "@/components/staff/money";
import { Dashboard } from "@/components/staff/dashboard";
import { Team } from "@/components/staff/team";
import { NotificationsBell } from "@/components/staff/notifications";
import { AppLinks } from "@/components/staff/app-links";

type StaffSearch = {
  view?: View | undefined;
  stage?: Stage | undefined;
  rep?: string | undefined;
  file?: string | undefined;
};

type View = "dashboard" | "engine" | "sent" | "funders" | "money" | "team";
const VIEWS: readonly View[] = ["dashboard", "engine", "sent", "funders", "money", "team"];
/** Tabs only admins see. */
const ADMIN_VIEWS: readonly View[] = ["team"];
const VIEW_TITLE: Record<View, string> = {
  dashboard: "Dashboard",
  engine: "Engine leads",
  sent: "Applications",
  funders: "Funders",
  money: "Money",
  team: "Team",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const Route = createFileRoute("/staff")({
  validateSearch: (s: Record<string, unknown>): StaffSearch => ({
    view: VIEWS.includes(s["view"] as View) ? (s["view"] as View) : undefined,
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
  const [reps, setReps] = useState<{ slug: string; name: string; admin_slug: string | null }[]>([]);
  const [repsTick, setRepsTick] = useState(0);

  const isStaff = access.state === "staff";
  useEffect(() => {
    // staff browsing the site shouldn't count as visitors
    if (isStaff) markStaffBrowser();
  }, [isStaff]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isStaff) return;
    sb.from("reps")
      .select("slug,name,admin_slug")
      .order("name")
      .then(({ data }) => setReps(data ?? []));
  }, [isStaff, repsTick]);

  if (access.state === "loading") {
    return (
      <PageShell member wide footer={false} tone="night">
        <div className="grid place-items-center py-40">
          <Loader2 className="size-6 animate-spin text-smoke" />
        </div>
      </PageShell>
    );
  }

  if (access.state !== "staff") {
    return (
      <PageShell member wide footer={false} tone="night">
        <div className="mx-auto max-w-xl px-5 py-24 text-center" data-staff-gate={access.state}>
          <h1 className="font-display text-2xl font-bold">Staff only</h1>
          <p className="mt-2 text-smoke">
            {access.state === "error" ? access.message : "This page is for the Lamp team."}
          </p>
          {access.state === "signed_out" && (
            <Link to="/login" className="mt-6 inline-block font-semibold text-forest">
              Sign in
            </Link>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell member wide footer={false} tone="night">
      <div className="w-full px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-smoke">
              {user?.email} · {access.isAdmin ? "Admin" : "Rep"}
              {access.repSlug && ` · /${access.repSlug}`}
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {search.view ? VIEW_TITLE[search.view] : "Files"}
            </h1>
          </div>
          <NotificationsBell />
        </div>
        {!search.file && (
          <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Staff views">
            <Link to="/staff" search={{}} className={viewTab(!search.view)} data-staff-view="files">
              Files
            </Link>
            {VIEWS.filter((v) => access.isAdmin || !ADMIN_VIEWS.includes(v)).map((v) => (
              <Link
                key={v}
                to="/staff"
                search={{ view: v }}
                className={viewTab(search.view === v)}
                data-staff-view={v}
              >
                {VIEW_TITLE[v]}
              </Link>
            ))}
          </nav>
        )}
        {!search.file && !search.view && (
          <AppLinks isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        )}
        {search.file ? (
          <FileView
            fileId={search.file}
            userId={access.userId}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : search.view === "dashboard" ? (
          <Dashboard isAdmin={access.isAdmin} repSlug={access.repSlug} />
        ) : search.view === "engine" ? (
          <EngineLeads isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : search.view === "sent" ? (
          <SentApplications isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : search.view === "funders" ? (
          <Funders isAdmin={access.isAdmin} />
        ) : search.view === "money" ? (
          <Money isAdmin={access.isAdmin} userId={access.userId} reps={reps} />
        ) : search.view === "team" ? (
          access.isAdmin ? (
            <Team onChanged={() => setRepsTick((t) => t + 1)} />
          ) : (
            <p className="mt-8 text-sm text-smoke">Only admins manage the team.</p>
          )
        ) : (
          <>
            <MyCalls isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
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
          </>
        )}
      </div>
    </PageShell>
  );
}

const viewTab = (on: boolean) =>
  on
    ? "rounded-full bg-ink px-4 py-1.5 font-semibold text-white"
    : "rounded-full px-4 py-1.5 font-semibold text-smoke ring-1 ring-line hover:text-ink";
