// Send back for changes: a rep (or an admin) asks a merchant to update their signed application,
// the merchant updates it and signs again, and the rep sees what changed. Shared by the staff
// file, the update page (/application/<rep>/changes) and the account page, and by the server
// (application-changes.server.ts). Pure functions and types only. See the migration
// 20261028120000_send_back_for_changes.sql.
//
// Merchant copy: never the word "loan".
import { brandedHtml } from "@/lib/application-links";
import type { Details } from "@/lib/application-details";
import { LIEN_TYPES, labelOf } from "@/lib/real-estate";

export const CHANGE_TTL_DAYS = 14;
export const MAX_ITEMS = 8;
export const MAX_LABEL = 140;
export const MAX_ITEM_NOTE = 300;
export const MAX_MESSAGE = 1000;
export const MAX_DOB_TRIES = 5;

export type ChangeSection = "business" | "owners" | "property" | "funding" | "other";

/**
 * One thing the rep asks for. The label is what the merchant reads; the target, when there is
 * one, is the part of the application the update page highlights (a path in Details, e.g.
 * "real_estate.properties.1").
 */
export type ChangeItem = { section: ChangeSection; target?: string; label: string; note?: string };

const TARGET_RE =
  /^(business|owners\.(0|1|new)|real_estate(\.properties\.(new|[0-9](\.liens(\.[0-9])?)?))?|balances|request|other)$/;
/** SSN-shaped text, as the database's _sensitive_text: nine digits, dashed or not. */
const SENSITIVE = /(^|\D)\d{3}[- ]?\d{2}[- ]?\d{4}(\D|$)/;
export const sensitiveText = (s: string) => SENSITIVE.test(s);

const SECTIONS: ChangeSection[] = ["business", "owners", "property", "funding", "other"];

/** The same rules the database applies (_valid_change_items), so staff hear about it first. */
export function validateItems(
  items: unknown,
): { ok: true; items: ChangeItem[] } | { ok: false; error: string } {
  if (!Array.isArray(items)) return { ok: false, error: "Tick what's missing." };
  if (items.length > MAX_ITEMS) return { ok: false, error: `At most ${MAX_ITEMS} items.` };
  const out: ChangeItem[] = [];
  for (const raw of items) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const section = x["section"];
    const label = typeof x["label"] === "string" ? x["label"].trim() : "";
    const target = typeof x["target"] === "string" ? x["target"].trim() : "";
    const note = typeof x["note"] === "string" ? x["note"].trim() : "";
    if (!SECTIONS.includes(section as ChangeSection))
      return { ok: false, error: "Unknown section." };
    if (label.length < 3 || label.length > MAX_LABEL)
      return { ok: false, error: `Each item needs 3 to ${MAX_LABEL} characters.` };
    if (target && !TARGET_RE.test(target))
      return { ok: false, error: "Unknown part of the application." };
    if (note.length > MAX_ITEM_NOTE) return { ok: false, error: "That note is too long." };
    if (sensitiveText(label) || sensitiveText(note))
      return { ok: false, error: "Leave SSNs out of what you ask." };
    out.push({
      section: section as ChangeSection,
      label,
      ...(target ? { target } : {}),
      ...(note ? { note } : {}),
    });
  }
  return { ok: true, items: out };
}

/** A suggestion the rep can tick, built from what the merchant signed. */
export type Suggestion = ChangeItem & { key: string };

/**
 * What a rep is likely to need, worded for the merchant: each property and each balance on it
 * with something left blank, then the usual sections. The rep can also type their own.
 */
export function changeSuggestions(d: Details): Suggestion[] {
  const out: Suggestion[] = [];
  const re = d.real_estate;
  if (re.owns === "yes") {
    re.properties.forEach((p, i) => {
      const where =
        [p.address, p.city]
          .map((x) => x.trim())
          .filter(Boolean)
          .join(", ") || `property ${i + 1}`;
      const target = `real_estate.properties.${i}`;
      (p.free_clear ? [] : p.liens.filter((l) => l.type)).forEach((l, j) => {
        const kind = (labelOf(LIEN_TYPES, l.type) || "balance").toLowerCase();
        const blank = [
          !l.balance.trim() && "balance",
          !l.holder.trim() && "lender",
          !l.payment.trim() && "payment",
        ]
          .filter(Boolean)
          .join(", ");
        if (blank)
          out.push({
            key: `lien-${i}-${j}`,
            section: "property",
            target: `${target}.liens.${j}`,
            label: `The ${blank} for the ${kind} on ${where}`.slice(0, 140),
          });
      });
      out.push({
        key: `owed-${i}`,
        section: "property",
        target: `${target}.liens`,
        label: `Everything owed on ${where} (mortgages, equity lines) and the balances`.slice(
          0,
          140,
        ),
      });
    });
    out.push({
      key: "property-missing",
      section: "property",
      target: "real_estate.properties.new",
      label: "A property you own that isn't on the application",
    });
  } else {
    out.push({
      key: "property-any",
      section: "property",
      target: "real_estate.properties.new",
      label: "Any real estate you own, and what's owed on it",
    });
  }
  d.owners.forEach((o, i) => {
    const name = `${o.first} ${o.last}`.trim();
    out.push({
      key: `owner-${i}`,
      section: "owners",
      target: `owners.${i}`,
      label: name
        ? `${name}'s details`
        : i === 0
          ? "The owner's details"
          : "The second owner's details",
    });
  });
  if (d.owners.length < 2)
    out.push({
      key: "owner-new",
      section: "owners",
      target: "owners.new",
      label: "A second owner",
    });
  out.push(
    {
      key: "balances",
      section: "funding",
      target: "balances",
      label: "Your current balances with other funders",
    },
    {
      key: "request",
      section: "funding",
      target: "request",
      label: "How much you need, and what for",
    },
    { key: "business", section: "business", target: "business", label: "Your business details" },
  );
  return out;
}

/** The update link. The token rides in the fragment, which browsers never send to a server. */
export const changesUrl = (site: string, repSlug: string, token: string) =>
  `${site.replace(/\/$/, "")}/application/${encodeURIComponent(repSlug)}/changes#c=${token}`;

/** The email's first line, worded for where the file stands; never a promise. */
export function defaultAsk(stage: string): string {
  if (stage === "offers_ready" || stage === "accepted" || stage === "closing")
    return "A funding partner needs one more thing to keep your offer moving.";
  if (stage === "declined") return "One more thing could help a funding partner take another look.";
  return "Funding partners need one more thing to look at your application.";
}

/**
 * The email asking for the update. "link": a link that opens their application (they confirm
 * their date of birth first). "account": they sign in to their Lamp account to update it.
 */
export function changesEmail(o: {
  firstName: string;
  businessName: string;
  repName: string;
  stage: string;
  message: string | null;
  items: ChangeItem[];
  url: string;
  mode: "link" | "account";
  legalName: string;
  address: string;
}): { subject: string; text: string; html: string } {
  const hi = o.firstName.trim() ? `Hi ${o.firstName.trim()},` : "Hi,";
  const forBiz = o.businessName.trim() ? ` for ${o.businessName.trim()}` : "";
  const subject = `One more thing for your Lamp application${forBiz}`;
  const ask = o.message?.trim() || defaultAsk(o.stage);
  const list = o.items.map((i) => `• ${i.label}${i.note ? ` (${i.note})` : ""}`);
  const how =
    o.mode === "link"
      ? "Open your application below. You'll confirm your date of birth, then everything you entered before is filled in: add what's missing and sign again. It takes a couple of minutes."
      : "Sign in to your Lamp account with this email address. Your application is there with everything you entered before: add what's missing and sign again.";
  const paragraphs = [
    ask,
    ...(list.length ? ["What's needed:", ...list] : []),
    how,
    "Your SSN and date of birth stay on file, so you won't type them again unless an owner's name changes.",
  ];
  const footer = [
    `You're getting this because you applied with ${o.repName} at Lamp. Not interested? Reply "stop" and we won't email you again.`,
    [o.legalName, o.address].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const button = o.mode === "link" ? "Update my application" : "Sign in to update it";
  const text = [
    hi,
    "",
    // the list of what's needed runs line by line under its heading
    ...paragraphs.flatMap((p, i) => (paragraphs[i + 1]?.startsWith("• ") ? [p] : [p, ""])),
    `${button}: ${o.url}`,
    "",
    "Any questions, just reply to this email.",
    "",
    o.repName,
    "Lamp · getlamp.app",
    "",
    ...footer,
  ].join("\r\n");
  const html = brandedHtml({ hi, paragraphs, button, url: o.url, repName: o.repName, footer });
  return { subject, text, html };
}

/** The note the rep gets when the merchant signs the update. Counts only, no values. */
export function signedAgainEmail(o: {
  repName: string;
  signer: string;
  businessName: string;
  version: number;
  asked: number;
  answered: number;
  changed: number;
  identity: boolean;
  fileUrl: string;
}): { subject: string; text: string } {
  const biz = o.businessName.trim() || "A merchant";
  const subject = `Signed again: ${biz} updated their Lamp application`;
  const lines = [
    `${o.repName.split(" ")[0] || "Hi"},`,
    "",
    `${o.signer} signed an updated application for ${biz} (version ${o.version}).`,
    o.asked
      ? `${o.answered} of the ${o.asked} thing${o.asked === 1 ? "" : "s"} you asked for changed; ${o.changed} answer${o.changed === 1 ? "" : "s"} changed in all.`
      : `${o.changed} answer${o.changed === 1 ? "" : "s"} changed.`,
    ...(o.identity
      ? ["", "A name, SSN, date of birth, phone or email changed too: check it before you send."]
      : []),
    "",
    `See what changed and mark it reviewed: ${o.fileUrl}`,
    "",
    "It goes to funders when you send it from the file.",
    "",
    "Lamp",
  ];
  return { subject, text: lines.join("\r\n") };
}

// ---------- Contracts between the pages and the server ----------

/** What the update page learns when it opens a link (POST /api/application/changes, "open"). */
export type ChangesOpenResponse = {
  state:
    | "verify"
    | "open"
    | "done"
    | "withdrawn"
    | "closed"
    | "stopped"
    | "expired"
    | "locked"
    | "sign_in"
    | "not_found";
  rep?: { slug: string; name: string; title: string | null } | null;
  first_name?: string;
  business_name?: string;
  wrong?: boolean;
  tries_left?: number;
  request?: {
    id: string;
    items: ChangeItem[];
    message: string | null;
    base_version: number;
    asked_at: string;
    expires_at: string;
    signed_before_at: string;
    second_signed_before: boolean;
  };
  /** The answers they signed, SSNs cut to the last four, dates of birth hidden. */
  prefill?: unknown;
};

export type ChangesSubmitBody = {
  action: "submit";
  /** From an update link: the token and the date of birth they confirmed (YYYY-MM-DD). */
  token?: string;
  dob?: string;
  /** From their account (with Authorization): the open request. */
  request_id?: string;
  base_version: number;
  details: Details;
  signature: { name: string; image: string; name2?: string | null; image2?: string | null };
  consent_version: string;
  company_fax?: string;
};

export type ChangesSubmitResponse = {
  application_id: string;
  version: number;
  signed_at: string;
  signer_ip: string | null;
  rep_name: string;
  /** The address the done screen offers for a sign-in link (link updates). */
  email: string | null;
};

/** Staff actions on /api/application-invites. */
export type SendBackRequest =
  | { action: "send_back"; application_id: string; items: ChangeItem[]; message?: string | null }
  | { action: "send_back_again"; request_id: string }
  | { action: "cancel_send_back"; request_id: string; reason?: string };

export type SendBackResult = {
  status: "sent" | "account" | "failed" | "cancelled";
  detail: string;
  request_id: string;
};

/** One signed version as staff see it (staff_application_versions): masked SSNs and birth dates. */
export type StaffVersion = {
  id: string;
  version: number;
  signed_at: string;
  signed_name: string;
  signed_name_2: string | null;
  signed_via: "link" | "account" | null;
  signer_ip: string | null;
  signer_agent: string | null;
  consent_version: string | null;
  recorded_by: string;
  change_request_id: string | null;
  business: unknown;
  owners: unknown;
  balances: unknown;
  request: unknown;
  real_estate: unknown;
  secret_changes: { ssn: boolean; dob: boolean; added: boolean }[] | null;
};

export type StaffChangeRequest = {
  id: string;
  status: "open" | "submitted" | "cancelled";
  items: ChangeItem[];
  message: string | null;
  base_version: number;
  channel: "email" | "account";
  sends: number;
  notified_at: string | null;
  created_at: string;
  requested_by_name: string | null;
  submitted_at: string | null;
  result_version: number | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  link: {
    email: string | null;
    sent_at: string;
    opened_at: string | null;
    verified_at: string | null;
    started_at: string | null;
    cancelled_at: string | null;
    expires_at: string;
    last_error: string | null;
    failed_checks: number;
    locked_at: string | null;
  } | null;
};

export type StaffVersions = { versions: StaffVersion[]; requests: StaffChangeRequest[] };

/** The holds FileSend shows, from where the file's changes stand. */
export function sendHold(v: StaffVersions | null | undefined): string | null {
  if (!v) return null;
  if (v.requests.some((r) => r.status === "open"))
    return "Sent back for changes: nothing goes to funders until the merchant signs the update or you cancel the request.";
  const newest = v.versions[0];
  if (newest && newest.version > 1) {
    const answered = v.requests.find((r) => r.result_version === newest.version);
    if (answered && !answered.reviewed_at)
      return "Review what changed in the merchant's update first (Mark reviewed, under Changes and versions).";
  }
  return null;
}
