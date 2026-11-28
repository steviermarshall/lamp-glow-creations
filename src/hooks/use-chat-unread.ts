import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { CHAT_READ_EVENT, INBOX_POLL_MS, unreadThreads, type InboxRow } from "@/lib/chat";

/**
 * The ids of this staff member's conversations that have something new: their number is the count
 * on the Messages tab, and the bell matches merchant message alerts against them. Empty (and no
 * more asking) until the Messages SQL has run.
 */
export function useChatUnread(enabled: boolean): string[] {
  const [threads, setThreads] = useState<string[]>([]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    let live = true;
    let timer = 0;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await sb.rpc("my_chat_inbox");
      if (!live) return;
      if (error) {
        window.clearInterval(timer); // not there yet, or not allowed: stop asking
        return;
      }
      const next = unreadThreads((data ?? []) as InboxRow[]);
      // same ids as before: keep the old array so nothing re-renders
      setThreads((prev) =>
        prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next,
      );
    };
    void load();
    timer = window.setInterval(() => void load(), INBOX_POLL_MS);
    // reading a conversation updates the count at once, not at the next look
    const onRead = () => void load();
    window.addEventListener(CHAT_READ_EVENT, onRead);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(CHAT_READ_EVENT, onRead);
    };
  }, [enabled]);
  return threads;
}
