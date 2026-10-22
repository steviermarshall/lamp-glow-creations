/** Engine leads: statuses, labels and the small helpers the staff view and tests share. */

export const ENGINE_STATUSES = [
  "new",
  "called",
  "no_answer",
  "callback",
  "qualified",
  "submitted",
  "funded",
  "dead",
  "do_not_call",
] as const;
export type EngineStatus = (typeof ENGINE_STATUSES)[number];

export const ENGINE_STATUS_LABEL: Record<EngineStatus, string> = {
  new: "New",
  called: "Called",
  no_answer: "No answer",
  callback: "Callback",
  qualified: "Qualified",
  submitted: "Submitted",
  funded: "Funded",
  dead: "Dead",
  do_not_call: "Do not call",
};

export const TIERS = ["A", "B", "C"] as const;

type Signal = { source?: string; signal_type?: string; signal_date?: string };

/** "nyc_license 2026-10-12 · fmcsa 2026-10-03": what the engine saw, newest first. */
export function signalSummary(signals: unknown): string {
  if (!Array.isArray(signals)) return "";
  return (signals as Signal[])
    .filter((s) => s && typeof s === "object")
    .map((s) => [s.source, s.signal_type, s.signal_date].filter(Boolean).join(" "))
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
}

export const tel = (phone: string | null) => (phone ?? "").replace(/[^0-9+]/g, "");
