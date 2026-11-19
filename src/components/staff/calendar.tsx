import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { chip } from "@/components/staff/field-styles";
import {
  type CalItem,
  type CardTone,
  isOverdue,
  itemView,
  moveTo,
  nyDay,
  nyAt,
  sayDay,
  shiftDay,
  weekOf,
} from "@/lib/calendar";

/**
 * Staff > Calendar (docs/calendar.md). Follow-ups Lamp schedules from what already happened, one card
 * per item: why it's there, a link to the record, Mark done, and Move to another day. The rules run on
 * Lamp's server when this loads (/api/calendar); Done and Move are written straight to calendar_items,
 * whose row rules let a person change only their own items (admins everyone's).
 */

export type Mode = "agenda" | "day" | "week";
const MODES: { key: Mode; label: string }[] = [
  { key: "agenda", label: "Agenda" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
];
const AGENDA_DAYS = 14;
const COLUMNS =
  "id,owner,rule,title,why,link,rep_slug,due_at,all_day,scheduled_at,status,done_at,cleared_at";

const PILL: Record<CardTone, string> = {
  ready: "bg-leaf/20 text-forest",
  working: "bg-sand text-ink",
  attention: "bg-red-100 text-red-800",
  done: "bg-sand text-ink",
  failed: "bg-red-100 text-red-800",
};

type Person = { id: string; name: string };
type Answer = {
  ready: boolean;
  me?: string;
  isAdmin?: boolean;
  items: CalItem[];
  people?: Person[];
  syncError?: string | null;
};

async function load(sync: boolean): Promise<Answer> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch(`/api/calendar${sync ? "?sync=1" : ""}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const j = (await r.json().catch(() => ({}))) as Answer & { error?: string };
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}

/** The page: loads, writes, and hands a plain view everything it shows. */
export function Calendar({ isAdmin }: { isAdmin: boolean }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>("agenda");
  const [day, setDay] = useState(() => nyDay(Date.now()));
  const [who, setWho] = useState("mine");
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async (sync: boolean) => {
    setLoadError("");
    try {
      setAnswer(await load(sync));
      setNow(new Date());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load the calendar.");
    }
  }, []);
  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const write = useCallback(
    async (id: string, patch: { status?: "open" | "done"; due_at?: string }) => {
      const sb = getSupabase();
      if (!sb) return;
      setBusy(id);
      setErrors((e) => ({ ...e, [id]: "" }));
      // the row comes back from the database: the card shows what was saved, not what was asked
      const r = await sb
        .from("calendar_items" as never)
        .update(patch as never)
        .eq("id" as never, id as never)
        .select(COLUMNS)
        .maybeSingle();
      setBusy(null);
      if (r.error || !r.data) {
        setErrors((e) => ({
          ...e,
          [id]: r.error?.message || "Not saved: this item isn't yours to change.",
        }));
        return;
      }
      const saved = r.data as unknown as CalItem;
      setAnswer((a) => (a ? { ...a, items: a.items.map((i) => (i.id === id ? saved : i)) } : a));
    },
    [],
  );

  if (loadError && !answer)
    return (
      <p className="mt-8 rounded-xl bg-red-100 px-4 py-3 text-sm text-red-900" role="alert">
        {loadError}
      </p>
    );
  if (answer && !answer.ready)
    return (
      <p className="mt-8 text-sm text-smoke" data-calendar-not-ready>
        The calendar isn't switched on yet: its table is added by an admin in the database
        (supabase/migrations/20261115120000_calendar.sql).
      </p>
    );

  return (
    <CalendarView
      items={answer?.items ?? null}
      people={answer?.people ?? []}
      me={answer?.me ?? null}
      isAdmin={isAdmin}
      now={now}
      mode={mode}
      day={day}
      who={who}
      busy={busy}
      errors={errors}
      note={
        answer?.syncError
          ? `Lamp's rules didn't run just now (${answer.syncError}). These are the items already scheduled.`
          : loadError
      }
      onMode={setMode}
      onDay={setDay}
      onWho={setWho}
      onRefresh={() => void refresh(true)}
      onDone={(id) => void write(id, { status: "done" })}
      onReopen={(id) => void write(id, { status: "open" })}
      onMove={(id, dueAt, to) => void write(id, { due_at: moveTo(dueAt, to) })}
    />
  );
}

export type ViewProps = {
  /** null while loading */
  items: CalItem[] | null;
  people: Person[];
  me: string | null;
  isAdmin: boolean;
  now: Date;
  mode: Mode;
  day: string;
  /** "mine", "all", "unassigned" or a person's id (admins) */
  who: string;
  busy: string | null;
  errors: Record<string, string>;
  note?: string | null;
  onMode: (m: Mode) => void;
  onDay: (d: string) => void;
  onWho: (w: string) => void;
  onRefresh: () => void;
  onDone: (id: string) => void;
  onReopen: (id: string) => void;
  onMove: (id: string, dueAt: string, day: string) => void;
};

const dayOf = (i: CalItem) => nyDay(Date.parse(i.due_at));
const byTime = (a: CalItem, b: CalItem) =>
  Number(b.all_day) - Number(a.all_day) || Date.parse(a.due_at) - Date.parse(b.due_at);

/** The calendar as a plain view: everything comes in as props. */
export function CalendarView(p: ViewProps) {
  const today = nyDay(p.now.getTime());
  const nameOf = useMemo(() => new Map(p.people.map((x) => [x.id, x.name])), [p.people]);
  const shown = useMemo(() => {
    const all = p.items ?? [];
    if (!p.isAdmin || p.who === "all") return all;
    if (p.who === "mine") return all.filter((i) => i.owner === p.me);
    if (p.who === "unassigned") return all.filter((i) => !i.owner);
    return all.filter((i) => i.owner === p.who);
  }, [p.items, p.isAdmin, p.who, p.me]);
  const ownerName = (i: CalItem) =>
    p.isAdmin && p.who !== "mine" && i.owner !== p.me
      ? i.owner
        ? (nameOf.get(i.owner) ?? "Someone")
        : "Unassigned"
      : null;

  const step = p.mode === "week" ? 7 : 1;
  const card = (i: CalItem, compact = false) => (
    <Fence key={i.id}>
      <ItemCard
        item={i}
        now={p.now}
        owner={ownerName(i)}
        busy={p.busy === i.id}
        locked={!!p.busy && p.busy !== i.id}
        error={p.errors[i.id] || null}
        compact={compact}
        onDone={() => p.onDone(i.id)}
        onReopen={() => p.onReopen(i.id)}
        onMove={(d) => p.onMove(i.id, i.due_at, d)}
      />
    </Fence>
  );

  return (
    <section className="mt-6" data-calendar aria-label="Calendar">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex gap-1 rounded-full p-1 ring-1 ring-line"
          role="group"
          aria-label="Show"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={p.mode === m.key}
              className={cn(
                "min-h-11 rounded-full px-4 text-sm font-semibold",
                p.mode === m.key ? "bg-ink text-white" : "text-smoke hover:text-ink",
              )}
              onClick={() => p.onMode(m.key)}
              data-static
            >
              {m.label}
            </button>
          ))}
        </div>
        {p.mode !== "agenda" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(chip, "min-h-11 min-w-11 justify-center")}
              aria-label={p.mode === "week" ? "Previous week" : "Previous day"}
              onClick={() => p.onDay(shiftDay(p.day, -step))}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={cn(chip, "min-h-11 px-4")}
              onClick={() => p.onDay(today)}
            >
              Today
            </button>
            <button
              type="button"
              className={cn(chip, "min-h-11 min-w-11 justify-center")}
              aria-label={p.mode === "week" ? "Next week" : "Next day"}
              onClick={() => p.onDay(shiftDay(p.day, step))}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
        {p.isAdmin && (
          <label className="flex items-center gap-2 text-sm text-smoke">
            <span className="sr-only">Whose calendar</span>
            <select
              className="min-h-11 rounded-full bg-white px-4 text-sm text-ink ring-1 ring-line"
              value={p.who}
              onChange={(e) => p.onWho(e.target.value)}
              data-calendar-who
            >
              <option value="mine">Mine</option>
              <option value="all">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {p.people
                .filter((x) => x.id !== p.me)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={cn(chip, "ml-auto min-h-11 gap-2 px-4")}
          onClick={p.onRefresh}
          data-calendar-refresh
        >
          <RefreshCw className="size-4" aria-hidden /> Check for new
        </button>
      </div>
      {p.note && (
        <p className="mt-3 rounded-xl bg-sand px-4 py-3 text-sm text-ink" role="status">
          {p.note}
        </p>
      )}

      {p.items === null ? (
        <Placeholder />
      ) : p.mode === "agenda" ? (
        <Agenda items={shown} now={p.now} today={today} card={card} />
      ) : p.mode === "day" ? (
        <DayList
          title={sayDay(nyAt(p.day, 12))}
          items={shown.filter((i) => dayOf(i) === p.day).sort(byTime)}
          card={card}
        />
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-7 xl:gap-2" data-calendar-week>
          {weekOf(p.day).map((d) => {
            const list = shown.filter((i) => dayOf(i) === d).sort(byTime);
            return (
              <div
                key={d}
                className={cn("min-w-0", d === today && "xl:rounded-xl xl:ring-2 xl:ring-leaf/60")}
              >
                <h3
                  className={cn(
                    "px-1 pb-2 pt-1 text-sm font-semibold",
                    d === today ? "text-forest" : "text-smoke",
                  )}
                >
                  {sayDay(nyAt(d, 12))}
                  {d === today && " · Today"}
                </h3>
                {list.length ? (
                  <div className="space-y-2">{list.map((i) => card(i, true))}</div>
                ) : (
                  <p className="px-1 text-xs text-smoke xl:py-2">Nothing scheduled</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Agenda({
  items,
  now,
  today,
  card,
}: {
  items: CalItem[];
  now: Date;
  today: string;
  card: (i: CalItem, compact?: boolean) => ReactNode;
}) {
  const open = items.filter((i) => i.status === "open");
  const overdue = open.filter((i) => isOverdue(i, now)).sort(byTime);
  const late = new Set(overdue.map((i) => i.id));
  const last = shiftDay(today, AGENDA_DAYS - 1);
  const days = Array.from({ length: AGENDA_DAYS }, (_, n) => shiftDay(today, n));
  const later = open.filter((i) => dayOf(i) > last).length;
  const doneToday = items.filter(
    (i) => i.status === "done" && i.done_at && nyDay(Date.parse(i.done_at)) === today,
  ).length;
  const sections = days
    .map((d) => ({ d, list: open.filter((i) => !late.has(i.id) && dayOf(i) === d).sort(byTime) }))
    .filter((s) => s.list.length || s.d === today);
  return (
    <div className="mt-5 space-y-6" data-calendar-agenda>
      {overdue.length > 0 && <DayList title="Overdue" tone="late" items={overdue} card={card} />}
      {sections.map((s) => (
        <DayList
          key={s.d}
          title={`${sayDay(nyAt(s.d, 12))}${s.d === today ? " · Today" : ""}`}
          items={s.list}
          card={card}
          empty={s.d === today ? "Nothing else due today." : undefined}
        />
      ))}
      <p className="text-sm text-smoke">
        {doneToday > 0 && `${doneToday} done today. `}
        {later > 0
          ? `${later} more after ${sayDay(nyAt(last, 12))}: use Week to see them.`
          : "Nothing scheduled further out."}
      </p>
    </div>
  );
}

function DayList({
  title,
  items,
  card,
  tone,
  empty = "Nothing scheduled.",
}: {
  title: string;
  items: CalItem[];
  card: (i: CalItem, compact?: boolean) => ReactNode;
  tone?: "late";
  empty?: string | undefined;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <h3
        className={cn(
          "mb-2 flex items-center gap-2 text-sm font-semibold",
          tone === "late" ? "text-ink" : "text-smoke",
        )}
        data-static
      >
        {tone === "late" ? (
          <span className="size-2.5 rounded-full bg-red-500" aria-hidden />
        ) : (
          <CalendarDays className="size-4" aria-hidden />
        )}{" "}
        {title}
        <span className="font-normal">· {items.length}</span>
      </h3>
      {items.length ? (
        <div className="space-y-2">{items.map((i) => card(i))}</div>
      ) : (
        <p className="text-sm text-smoke">{empty}</p>
      )}
    </div>
  );
}

function Placeholder() {
  return (
    <div className="mt-5 space-y-2" aria-busy="true">
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          className={cn(card, "p-4")}
          data-agent-card
          data-tone="working"
          data-loading
          tabIndex={-1}
        >
          <div className="h-5 w-56 max-w-full rounded-full bg-sand" />
          <div className="mt-2 h-4 w-40 max-w-full rounded-full bg-sand" />
          <div className="mt-3 h-4 w-full rounded-full bg-sand" />
          <div className="mt-3 h-11 w-36 rounded-full bg-sand" />
        </div>
      ))}
      <span className="sr-only">Loading your calendar.</span>
    </div>
  );
}

export function ItemCard({
  item,
  now,
  owner,
  busy,
  locked,
  error,
  compact,
  onDone,
  onReopen,
  onMove,
}: {
  item: CalItem;
  now: Date;
  owner: string | null;
  busy: boolean;
  locked: boolean;
  error: string | null;
  compact?: boolean;
  onDone: () => void;
  onReopen: () => void;
  onMove: (day: string) => void;
}) {
  const v = itemView(item, now, { busy, error });
  const root = useRef<HTMLElement>(null);
  const [moving, setMoving] = useState(false);
  // when Mark done goes away, the card takes the keyboard focus so it never falls off the page
  const hadPrimary = useRef(!!v.primary);
  useEffect(() => {
    const el = root.current;
    if (hadPrimary.current && !v.primary && el) {
      const at = document.activeElement;
      if (!at || at === document.body || el.contains(at)) el.focus();
    }
    hadPrimary.current = !!v.primary;
  }, [v.primary]);

  const quiet =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-forest hover:underline";
  return (
    <article
      ref={root}
      className={cn(card, "p-4 outline-none focus-visible:ring-2 focus-visible:ring-forest")}
      data-agent-card
      data-tone={v.tone}
      data-calendar-item={item.rule}
      tabIndex={-1}
      aria-labelledby={`cal-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`cal-${item.id}`} className="break-words font-semibold">
            {item.title}
          </h4>
          <p className="mt-0.5 text-xs text-smoke">
            {v.subtitle}
            {owner && ` · ${owner}`}
          </p>
        </div>
        <span
          className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[v.tone])}
        >
          {v.pill}
        </span>
      </div>
      <p
        className={cn("mt-2 break-words text-sm text-smoke", compact && "xl:line-clamp-4")}
        data-now
      >
        {v.next}
      </p>
      {error && (
        <p className="mt-2 rounded-xl bg-red-100 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {v.primary && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-leaf px-5 text-sm font-semibold text-ink transition hover:brightness-105 aria-busy:bg-sand aria-disabled:bg-sand"
            data-primary
            aria-busy={busy}
            aria-disabled={locked}
            onClick={() => {
              if (!busy && !locked) onDone();
            }}
          >
            {busy ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            {v.primary.label}
          </button>
        )}
        {item.link && (
          <Link to="/staff" search={searchOf(item.link) as never} className={quiet}>
            <ExternalLink className="size-3.5" aria-hidden /> Open
          </Link>
        )}
        {v.canMove && !moving && (
          <button
            type="button"
            className={quiet}
            onClick={() => setMoving(true)}
            aria-disabled={locked}
          >
            <CalendarDays className="size-3.5" aria-hidden /> Move
          </button>
        )}
        {v.canReopen && (
          <button
            type="button"
            className={quiet}
            aria-disabled={locked}
            onClick={() => {
              if (!locked) onReopen();
            }}
          >
            <Undo2 className="size-3.5" aria-hidden /> Not done
          </button>
        )}
      </div>
      {moving && v.canMove && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-smoke">Move to</span>
          <input
            type="date"
            className="min-h-11 rounded-full bg-white px-4 text-sm text-ink ring-1 ring-line"
            defaultValue={nyDay(Date.parse(item.due_at))}
            min={nyDay(now.getTime())}
            onChange={(e) => {
              const d = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !locked) {
                setMoving(false);
                onMove(d);
              }
            }}
            autoFocus
          />
          <button type="button" className={quiet} onClick={() => setMoving(false)}>
            Cancel
          </button>
        </label>
      )}
    </article>
  );
}

/** "/staff?file=..." as the search object the staff page reads. */
export const searchOf = (link: string) =>
  Object.fromEntries(new URL(link, "https://getlamp.app").searchParams);

/** One card that fails to draw shows a small note; the rest of the calendar keeps working. */
class Fence extends Component<{ children: ReactNode }, { broken: boolean }> {
  override state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  override render() {
    return this.state.broken ? (
      <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink">Couldn't show this item.</p>
    ) : (
      this.props.children
    );
  }
}
