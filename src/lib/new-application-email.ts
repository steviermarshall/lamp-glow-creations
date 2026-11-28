// The email a signed application sends: to the rep whose link it came in on, with Asad and Stevie
// copied on every one (NEW_APPLICATION_COPY in site.ts). Laid out like Tip Top's: the details a
// rep needs at the top, a warning when the tax ID is already in Lamp, and the signed application
// and bank statements attached. No SSN or date of birth in the body; those are in the PDF only.
// Pure, so it's unit-tested in tests/new-application-email.test.ts.

/** "22-1234567" and "221234567": the two ways a tax ID is typed, for the duplicate lookup. */
export function einVariants(raw: string | null | undefined): string[] {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length !== 9) return [];
  return [`${d.slice(0, 2)}-${d.slice(2)}`, d];
}

export function prettyEin(raw: string | null | undefined): string {
  const v = einVariants(raw);
  return v[0] ?? (raw ?? "").trim();
}

/** One message: the rep in To, everyone else copied, nobody twice. Null when there's no one. */
export function recipients(
  repEmail: string | null | undefined,
  copy: readonly string[],
): { to: string; cc: string[] } | null {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const raw of [repEmail ?? "", ...copy]) {
    const e = raw.trim().toLowerCase();
    if (!e || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e) || seen.has(e)) continue;
    seen.add(e);
    all.push(e);
  }
  const [to, ...cc] = all;
  return to ? { to, cc } : null;
}

export type Duplicate = {
  business: string;
  stage: string;
  rep: string | null;
  signedAt: string | null;
};

export type NewApplication = {
  repName: string | null;
  /** "an application link" or "their Lamp account" */
  via: string;
  signer: string;
  business: Partial<
    Record<
      | "legal_name"
      | "dba"
      | "ein"
      | "phone"
      | "email"
      | "monthly_revenue"
      | "start_date"
      | "industry"
      | "premises"
      | "rent",
      string
    >
  >;
  owner: Partial<Record<"first" | "last" | "email" | "mobile", string>>;
  amount: string | null;
  openPositions: number;
  ownsRealEstate: boolean;
  fileUrl: string;
  duplicates: Duplicate[];
  attached: { application: boolean; statements: number; leftOff: number };
};

const money = (v: string | null | undefined) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return v && Number.isFinite(n) && n > 0
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : (v ?? "").trim();
};
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

export function newApplicationEmail(a: NewApplication): { subject: string; text: string } {
  const biz = a.business.legal_name?.trim() || "A merchant";
  const ein = prettyEin(a.business.ein);
  const dup = a.duplicates.length > 0;
  const amount = money(a.amount);
  const subject = [
    dup ? "ALREADY IN LAMP · " : "",
    `Signed: ${biz}`,
    amount ? ` · ${amount}` : "",
    a.repName ? ` · ${a.repName}` : "",
  ].join("");

  const lines: string[] = [];
  if (dup) {
    lines.push(
      `THE TAX ID ${ein} IS ALREADY IN LAMP:`,
      ...a.duplicates.map(
        (d) =>
          `- ${d.business || "Unnamed file"} (${d.stage}${d.rep ? `, ${d.rep}` : ", no rep"}${d.signedAt ? `, signed ${day(d.signedAt)}` : ""})`,
      ),
      "DOUBLE-CHECK BEFORE SUBMITTING IT TO A FUNDER.",
      "",
    );
  }
  const owner = [a.owner.first, a.owner.last]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const premises =
    a.business.premises === "own"
      ? "Owns the business premises"
      : a.business.rent
        ? money(a.business.rent)
        : "";
  const row = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) lines.push(`${label}: ${v}`);
  };
  row("Name", owner || a.signer);
  row("Email", a.owner.email || a.business.email);
  row("Phone", a.owner.mobile || a.business.phone);
  row("Business name", a.business.dba?.trim() ? `${biz} (DBA ${a.business.dba.trim()})` : biz);
  row("Tax ID", ein);
  row("Amount requested", amount);
  row("Monthly revenue", money(a.business.monthly_revenue));
  row(a.business.premises === "own" ? "Premises" : "Rent amount", premises);
  row("Open positions", String(a.openPositions));
  row("Owns real estate", a.ownsRealEstate ? "Yes, see the signing record on the file" : "No");
  row("Rep", a.repName ? `${a.repName}, from ${a.via}` : `No rep yet, from ${a.via}`);
  lines.push("");

  const att = a.attached;
  const files = [
    att.application ? "the signed application" : "",
    att.statements ? `${att.statements} bank statement${att.statements === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  if (files.length) lines.push(`Attached: ${files.join(" and ")}.`);
  if (!att.application)
    lines.push("The signed PDF didn't come through; download it from the file.");
  if (att.leftOff)
    lines.push(
      `${att.leftOff} more statement${att.leftOff === 1 ? " is" : "s are"} on the file but couldn't be attached.`,
    );
  else if (!att.statements) lines.push("No bank statements yet.");
  lines.push("", `Open the file: ${a.fileUrl}`, "", "Lamp");
  return { subject, text: lines.join("\r\n") };
}

/**
 * Why a heads-up isn't the usual one. "not_saved": Lamp couldn't save the start, so the team adds
 * the person by hand. "inactive_link": they used a rep link that has been switched off, so the
 * copy list gets it and gives them to a rep.
 */
export type StartedNote = "not_saved" | "inactive_link";

/**
 * The heads-up a rep gets the moment someone starts the application on their link (the first
 * screen: name, phone, email), with Asad and Stevie copied. The best time to call is now. Only
 * what they typed on that screen and the quick questions: never an SSN or the long form.
 */
export function startedEmail(a: {
  repName: string | null;
  first: string;
  last: string;
  business?: string;
  phone: string;
  email: string;
  textsOk: boolean;
  /** The quick questions they answered first, a line each ("Looking for: $50k – $100k"). */
  answered?: string[];
  note?: StartedNote;
  /**
   * The link's slug when Lamp couldn't look its rep up (the database failed, not "no such rep"):
   * the copy list gets it instead of the rep, so it names the link and asks them to pass it on.
   */
  unknownRep?: string;
}): { subject: string; text: string } {
  const answered = a.answered ?? [];
  const name = `${a.first} ${a.last}`.trim();
  const inactive = a.note === "inactive_link";
  const unknown = !inactive && a.unknownRep ? a.unknownRep : "";
  const repName = unknown ? null : a.repName;
  const where = unknown
    ? ` on the "${unknown}" link`
    : repName
      ? ` on ${repName}'s link`
      : " on the website";
  const subject = inactive
    ? `Inactive link: ${name} tried to start the application${where}`
    : `${a.note === "not_saved" ? "NOT SAVED IN LAMP · " : ""}${unknown ? "REP NOT LOOKED UP · " : ""}Started: ${name} opened the application${where}`;
  const intro = inactive
    ? [
        `${name} tried to start the application on ${a.repName ?? "a rep"}'s link, but that link is inactive, so Lamp didn't save them.`,
        "Not saved in Lamp, add this person by hand and give them to a rep. Now is the time to call.",
      ]
    : [
        unknown
          ? `${name} just started the application on the rep link "${unknown}". Lamp couldn't look up that rep just now, so this came to you instead of them. Pass them to that rep: they haven't signed yet, so now is the time to call.`
          : repName
            ? `${name} just started the application on your link. They haven't signed yet, so now is the time to call.`
            : `${name} just started the application on the website (getlamp.app). No rep has them yet. They haven't signed, so now is the time to call.`,
        ...(a.note === "not_saved"
          ? [
              "",
              "Not saved in Lamp, add this person by hand. Lamp couldn't save this start, so they aren't on the dashboard and won't get finish reminders.",
            ]
          : []),
      ];
  const text = [
    `${(!inactive && repName?.split(" ")[0]) || "Hi"},`,
    "",
    ...intro,
    "",
    `Name: ${name}`,
    ...(a.business ? [`Business: ${a.business}`] : []),
    `Phone: ${a.phone}`,
    `Email: ${a.email}`,
    `Texts OK: ${a.textsOk ? "Yes" : "No, calls only"}`,
    ...(answered.length ? ["", "What they told us:", ...answered] : []),
    ...(inactive
      ? []
      : [
          "",
          "When they sign, you'll get the signed application and their statements in a second email.",
        ]),
    "",
    "Lamp",
  ].join("\r\n");
  return { subject, text };
}
