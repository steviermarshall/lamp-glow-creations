import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Database } from "@/integrations/supabase/types";

export type Stage = Database["public"]["Enums"]["application_stage"];
export type EventKind = Database["public"]["Enums"]["event_kind"];
export type DocStatus = Database["public"]["Enums"]["document_status"];

/** All eleven stages, in pipeline order. */
export const STAGES: readonly Stage[] = [
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
  "funded",
  "declined",
  "withdrawn",
  "closed",
];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  reviewing: "Reviewing",
  docs_needed: "Docs needed",
  submitted: "Submitted",
  offers_ready: "Offers ready",
  accepted: "Accepted",
  closing: "Closing",
  funded: "Funded",
  declined: "Declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export const isStage = (v: unknown): v is Stage =>
  typeof v === "string" && (STAGES as readonly string[]).includes(v);

export const EVENT_LABEL: Record<EventKind, string> = {
  stage_change: "Stage",
  assigned: "Assigned",
  note: "Note",
  call: "Call",
  email: "Email",
  sms: "Text",
  meeting: "Meeting",
  document_uploaded: "Document uploaded",
  document_reviewed: "Document reviewed",
  submitted_to_funder: "Sent to funder",
  offer_received: "Offer received",
  offer_presented: "Offer presented",
  offer_accepted: "Offer accepted",
  offer_declined: "Offer declined",
  funded: "Funded",
  system: "System",
};

/** "3d", "5h", "12m": how long ago, short enough for a table cell. */
export function age(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const stamp = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export type StaffAccess =
  | { state: "loading" }
  | { state: "signed_out" }
  | { state: "denied" }
  | { state: "error"; message: string }
  | { state: "staff"; userId: string; isAdmin: boolean; repSlug: string | null };

/**
 * Who the signed-in user is to the pipeline. Roles come from user_roles (a user reads only
 * their own rows) and the rep slug from current_rep_slug(); the database enforces the same
 * rules again on every read and write, so this only decides what to show.
 */
export function useStaffAccess(userId: string | null, authLoading: boolean): StaffAccess {
  const [access, setAccess] = useState<StaffAccess>({ state: "loading" });

  useEffect(() => {
    if (authLoading) return;
    const sb = getSupabase();
    if (!sb || !userId) {
      setAccess({ state: "signed_out" });
      return;
    }
    let live = true;
    setAccess({ state: "loading" });
    (async () => {
      const [roles, slug] = await Promise.all([
        sb.from("user_roles").select("role").eq("user_id", userId),
        sb.rpc("current_rep_slug"),
      ]);
      if (!live) return;
      if (roles.error) {
        setAccess({ state: "error", message: "Couldn't check your access. Refresh to try again." });
        return;
      }
      const held = new Set(roles.data.map((r) => r.role));
      const isAdmin = held.has("admin");
      if (!isAdmin && !held.has("rep")) {
        setAccess({ state: "denied" });
        return;
      }
      setAccess({
        state: "staff",
        userId,
        isAdmin,
        repSlug: slug.error ? null : (slug.data ?? null),
      });
    })();
    return () => {
      live = false;
    };
  }, [userId, authLoading]);

  return access;
}
