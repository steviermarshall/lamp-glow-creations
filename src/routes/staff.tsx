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
import { MyLists } from "@/components/staff/my-lists";
import { EmailReplies } from "@/components/staff/email-replies";
import { EmailReview } from "@/components/staff/email-review";
import { EngineStatus } from "@/components/staff/engine-status";
import { MyCalls } from "@/components/staff/notes-calls";
import { Today } from "@/components/staff/today";
import { LeadProfile } from "@/components/staff/lead-profile";
import { SentApplications } from "@/components/staff/sent-applications";
import { Funders } from "@/components/staff/funders";
import { Money } from "@/components/staff/money";
import { Dashboard } from "@/components/staff/dashboard";
import { Team } from "@/components/staff/team";
import { AiActivity } from "@/components/staff/ai-activity";
import { NotificationsBell } from "@/components/staff/notifications";
import { AppLinks } from "@/components/staff/app-links";
import { Training } from "@/components/staff/training";
import { ChatDock, useChatDock } from "@/components/chat/chat-dock";
import { CHAT_OPEN_EVENT } from "@/lib/chat-dock";
import { useChatUnread } from "@/hooks/use-chat-unread";
import { FocusRing } from "@/components/staff/focus-ring";
import { inFocusPilot } from "@/lib/focus";
import { knownTeam, roleLabel } from "@/lib/team-lead";

type StaffSearch = {
  // "messages" was a tab before Messages became the side panel: an old link opens the panel
  view?: View | "messages" | undefined;
  stage?: Stage | undefined;
  rep?: string | undefined;
  file?: string | undefined;
  lead?: string | undefined;
  thread?: string | undefined;
};

type View =
  | "dashboard"
  | "engine"
  | "lists"
  | "replies"
  | "autopilot"
  | "sent"
  | "funders"
  | "money"
  | "team"
  | "ai"
  | "training";
const VIEWS: readonly View[] = [
  "dashboard",
  "engine",
  "lists",
  "replies",
  "autopilot",
  "sent",
  "funders",
  "money",
  "team",
  "ai",
  "training",
];
/** Tabs only admins see. */
const ADMIN_VIEWS: readonly View[] = ["autopilot", "team", "ai"];
const VIEW_TITLE: Record<View, string> = {
  dashboard: "Dashboard",
  engine: "Engine leads",
  lists: "My lists",
  replies: "Email replies",
  autopilot: "Email engine",
  sent: "Applications",
  funders: "Funders",
  money: "Money",
  team: "Team",
  ai: "AI activity",
  training: "Training",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const Route = createFileRoute("/staff")({
  validateSearch: (s: Record<string, unknown>): StaffSearch => ({
    view:
      s["view"] === "messages"
        ? "messages"
        : VIEWS.includes(s["view"] as View)
          ? (s["view"] as View)
          : undefined,
    stage: isStage(s["stage"]) ? s["stage"] : undefined,
    rep:
      typeof s["rep"] === "string" && (s["rep"] === "unassigned" || SLUG.test(s["rep"]))
        ? s["rep"]
        : undefined,
    file: typeof s["file"] === "string" && UUID.test(s["file"]) ? s["file"] : undefined,
    lead: typeof s["lead"] === "string" && UUID.test(s["lead"]) ? s["lead"] : undefined,
    thread: typeof s["thread"] === "string" && UUID.test(s["thread"]) ? s["thread"] : undefined,
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
  // My lists is a tab only for someone who has a list (or is on the page making their first)
  const [hasLists, setHasLists] = useState(false);
  const [listsTick, setListsTick] = useState(0);

  const isStaff = access.state === "staff";
  const chatUnread = useChatUnread(isStaff);
  const dock = useChatDock();
  // an old Staff > Messages link: open the side panel (on its conversation), then drop it from the address
  const oldMessagesLink = search.view === "messages";
  const oldThread = search.thread;
  useEffect(() => {
    if (!oldMessagesLink || !dock.ready) return;
    window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { thread: oldThread } }));
    void navigate({
      search: (s) => ({ ...s, view: undefined, thread: undefined }),
      replace: true,
    });
  }, [oldMessagesLink, oldThread, dock.ready, navigate]);
  const view: View | undefined = search.view === "messages" ? undefined : search.view;
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
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isStaff) return;
    // the database only counts this person's own lists; an error means the table isn't there yet
    sb.from("private_lists")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => setHasLists(!error && (count ?? 0) > 0));
  }, [isStaff, listsTick]);

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

  // the reps who report to this person: a lead sees their files too (the database decides)
  const team = access.isAdmin ? [] : knownTeam(access.teamSlugs, reps);

  return (
    <PageShell member wide footer={false} tone="night">
      <div
        className={
          // a wide screen makes room for the Messages panel while it is open
          "w-full px-5 pb-24 pt-10 sm:px-8 sm:pt-14" + (dock.state.open ? " lg:pr-[26rem]" : "")
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-smoke">
              {user?.email} · {roleLabel(access.isAdmin, team.length)}
              {access.repSlug && ` · /${access.repSlug}`}
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {search.lead ? "Lead" : view ? VIEW_TITLE[view] : "Files"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {access.repSlug && inFocusPilot(access.repSlug) && (
              <FocusRing repSlug={access.repSlug} />
            )}
            <NotificationsBell chatUnread={chatUnread} />
          </div>
        </div>
        {!search.file && !search.lead && (
          <nav
            className={
              // on a phone one row that scrolls sideways
              "-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 text-sm [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
            }
            aria-label="Staff views"
          >
            <Link to="/staff" search={{}} className={viewTab(!view)} data-staff-view="files">
              Files
            </Link>
            {VIEWS.filter(
              (v) =>
                (access.isAdmin || !ADMIN_VIEWS.includes(v)) &&
                (v !== "lists" || hasLists || view === "lists"),
            ).map((v) => (
              <Link
                key={v}
                to="/staff"
                search={{ view: v }}
                className={viewTab(view === v)}
                data-staff-view={v}
              >
                {VIEW_TITLE[v]}
              </Link>
            ))}
          </nav>
        )}
        {!search.file && !search.lead && !view && (
          <AppLinks isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        )}
        {search.lead ? (
          <LeadProfile
            leadId={search.lead}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : search.file ? (
          <FileView
            fileId={search.file}
            userId={access.userId}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : view === "dashboard" ? (
          <Dashboard isAdmin={access.isAdmin} repSlug={access.repSlug} />
        ) : view === "engine" ? (
          <EngineLeads isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : view === "lists" ? (
          <MyLists onChanged={() => setListsTick((t) => t + 1)} />
        ) : view === "replies" ? (
          <EmailReplies isAdmin={access.isAdmin} reps={reps} />
        ) : view === "autopilot" ? (
          access.isAdmin ? (
            <>
              <EmailReview />
              <EngineStatus />
            </>
          ) : (
            <p className="mt-8 text-sm text-smoke">The email engine is for admins.</p>
          )
        ) : view === "sent" ? (
          <SentApplications isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : view === "funders" ? (
          <Funders isAdmin={access.isAdmin} />
        ) : view === "money" ? (
          <Money isAdmin={access.isAdmin} userId={access.userId} reps={reps} />
        ) : view === "training" ? (
          <Training isAdmin={access.isAdmin} />
        ) : view === "team" ? (
          access.isAdmin ? (
            <Team onChanged={() => setRepsTick((t) => t + 1)} />
          ) : (
            <p className="mt-8 text-sm text-smoke">Only admins manage the team.</p>
          )
        ) : view === "ai" ? (
          access.isAdmin ? (
            <AiActivity />
          ) : (
            <p className="mt-8 text-sm text-smoke">AI activity is for admins.</p>
          )
        ) : (
          <>
            <Today isAdmin={access.isAdmin} reps={reps} />
            <MyCalls isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
            <Board
              isAdmin={access.isAdmin}
              repSlug={access.repSlug}
              team={team}
              stage={search.stage}
              rep={access.isAdmin || team.length ? (search.rep ?? "all") : "all"}
              reps={reps}
              onStage={(stage) => navigate({ search: (s) => ({ ...s, stage }) })}
              onRep={(rep) =>
                navigate({ search: (s) => ({ ...s, rep: rep === "all" ? undefined : rep }) })
              }
            />
          </>
        )}
      </div>
      {dock.ready && (
        <ChatDock
          userId={access.userId}
          isAdmin={access.isAdmin}
          unread={chatUnread}
          state={dock.state}
          set={dock.set}
        />
      )}
    </PageShell>
  );
}

const viewTab = (on: boolean) =>
  on
    ? "shrink-0 whitespace-nowrap rounded-full bg-ink px-4 py-1.5 font-semibold text-white"
    : "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 font-semibold text-smoke ring-1 ring-line hover:text-ink";
