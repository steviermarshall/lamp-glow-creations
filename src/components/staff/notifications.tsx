import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { age } from "@/lib/staff";

/**
 * The bell on /staff: this person's own notifications (new files on their link, documents,
 * accepted offers, funded files, people starting on their link) and "What's new"
 * announcements. The database writes them (migration 20261029090000_notifications.sql) and
 * shows each person only their own; this marks them read. Checks every minute and when the
 * tab comes back into view.
 */

type Note = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

const POLL_MS = 60_000;
const SHOWN = 40;

export function NotificationsBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("notifications" as never)
      .select("id,kind,title,body,link,created_at,read_at")
      .order("created_at", { ascending: false })
      .limit(SHOWN);
    if (data) setNotes(data as unknown as Note[]);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // close on a click outside or Escape
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  async function markRead(ids: number[]) {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setNotes((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    await getSupabase()
      ?.from("notifications" as never)
      .update({ read_at: now } as never)
      .in("id", ids);
  }

  function openNote(n: Note) {
    void markRead([n.id]);
    setOpen(false);
    if (!n.link) return;
    if (n.link.startsWith("/")) void navigate({ to: n.link as never });
    else window.open(n.link, "_blank", "noopener");
  }

  const unread = notes.filter((n) => !n.read_at);

  return (
    <div ref={ref} className="relative" data-notifications>
      <button
        type="button"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-full ring-1 ring-line transition hover:ring-ink/30"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-4.5" />
        {unread.length > 0 && (
          <span
            className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-leaf px-1 text-[0.7rem] font-bold leading-5 text-ink"
            data-unread={unread.length}
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] ring-1 ring-line"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread.length > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-forest hover:underline"
                onClick={() => void markRead(unread.map((n) => n.id))}
              >
                <Check className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          {notes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-smoke">
              Nothing yet. New files, documents and offers on your deals show up here.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition hover:bg-sand",
                      !n.read_at && "bg-leaf/10",
                    )}
                    onClick={() => openNote(n)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read_at ? "bg-transparent" : "bg-leaf",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        {n.kind === "announcement" && (
                          <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white">
                            What's new
                          </span>
                        )}
                        <span className="truncate text-sm font-semibold">{n.title}</span>
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-smoke">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[0.7rem] text-smoke">
                        {age(n.created_at)} ago
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
