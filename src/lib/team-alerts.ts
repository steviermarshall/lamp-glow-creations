// Lamp in Discord: the wording and parsing, with no imports so the deno tests load it directly.
// The sending lives in discord.server.ts; setup is in docs/discord.md.

/**
 * Notification kinds the team channel also hears about (the rest are only the person's DM). A
 * merchant's chat message ('message', 20261127110000_chat_staff_alerts.sql) is left out on purpose:
 * it goes to the rep's DM only, and names the business, never what the merchant wrote.
 */
export const CHANNEL_KINDS = ["file", "offer", "funded", "started"] as const;

export type TeamNotification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  application_id: string | null;
};

/** Discord markdown and mentions in a business name stay plain text. */
export const esc = (s: string) =>
  s
    .replace(/([\\*_~`|>#\-[\]()])/g, "\\$1")
    .replace(/@/g, "@​")
    .slice(0, 400);

/** A link back into Lamp: only paths on the site, never anything else a row might hold. */
export function lampLink(site: string, link: string | null): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
  return site.replace(/\/$/, "") + link;
}

/** The DM a person gets: what their Lamp bell says, with a link to open it. */
export function dmText(n: TeamNotification, site: string): string {
  const url = lampLink(site, n.link) ?? lampLink(site, "/staff");
  return [
    `**${esc(n.title)}**`,
    n.body ? esc(n.body) : null,
    url ? `[Open in Lamp](<${url}>)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const CHANNEL_ICON: Record<string, string> = {
  file: "📄",
  offer: "🤝",
  funded: "💰",
  started: "✍️",
};

/** The team channel's line for a deal event, with whose file it is. */
export function channelText(n: TeamNotification, site: string, repName: string | null): string {
  const url = lampLink(site, n.link);
  return [
    `${CHANNEL_ICON[n.kind] ?? "🔔"} **${esc(n.title)}**${repName ? ` · ${esc(repName)}` : ""}`,
    n.body ? esc(n.body) : null,
    url ? `[Open the file](<${url}>)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * One event reaches the channel once, though the database writes a notification for each person
 * who hears it (the rep and their admin): the key is the event, not the notification.
 */
export const channelKey = (n: TeamNotification) =>
  n.application_id && (CHANNEL_KINDS as readonly string[]).includes(n.kind)
    ? `${n.kind}:${n.application_id}`
    : null;

export type LampCommand =
  { cmd: "today" } | { cmd: "lead"; query: string } | { cmd: "link" } | { cmd: "help" };

type Option = { name?: unknown; type?: unknown; value?: unknown; options?: unknown };

/** /lamp's subcommand from a Discord interaction's data.options. */
export function parseCommand(options: unknown): LampCommand {
  const sub = Array.isArray(options) ? (options[0] as Option | undefined) : undefined;
  const name = typeof sub?.name === "string" ? sub.name : "";
  if (name === "today") return { cmd: "today" };
  if (name === "link") return { cmd: "link" };
  if (name === "lead") {
    const q = Array.isArray(sub?.options)
      ? (sub!.options as Option[]).find((o) => o?.name === "query")?.value
      : undefined;
    const query = typeof q === "string" ? q.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    return query.length >= 2 ? { cmd: "lead", query } : { cmd: "help" };
  }
  return { cmd: "help" };
}

/** /lamp as Discord registers it: one command, four subcommands. */
export const LAMP_COMMAND = {
  name: "lamp",
  description: "Your leads and files in Lamp",
  type: 1,
  options: [
    { type: 1, name: "today", description: "Your leads and files right now" },
    {
      type: 1,
      name: "lead",
      description: "Find one of your leads by name or phone",
      options: [
        {
          type: 3,
          name: "query",
          description: "Business name or phone number",
          required: true,
          min_length: 2,
          max_length: 80,
        },
      ],
    },
    { type: 1, name: "link", description: "Connect your Discord to your Lamp login" },
    { type: 1, name: "help", description: "What /lamp can do" },
  ],
} as const;

export const HELP_TEXT = [
  "**Lamp in Discord**",
  "`/lamp today`: your leads and files right now",
  "`/lamp lead ISK` or `/lamp lead 718-555`: find one of your leads",
  "`/lamp link`: connect your Discord to your Lamp login, once, so your alerts come here as DMs",
  "Only you see these answers.",
].join("\n");

const STATUS_WORD: Record<string, string> = {
  new: "new",
  called: "called",
  no_answer: "no answer",
  callback: "callback",
  qualified: "qualified",
  submitted: "submitted",
  funded: "funded",
  dead: "dead",
  do_not_call: "do not call",
};

/** /lamp today: how many leads in each status, and files by stage. */
export function todayText(
  name: string,
  leads: Record<string, number>,
  files: Record<string, number>,
  site: string,
): string {
  const line = (m: Record<string, number>, words: Record<string, string> = {}) =>
    Object.entries(m)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${words[k] ?? k.replace(/_/g, " ")}`)
      .join(", ") || "none";
  return [
    `**${esc(name)}, here's where you stand**`,
    `Engine leads: ${line(leads, STATUS_WORD)}`,
    `Files: ${line(files)}`,
    `[Open Lamp](<${site.replace(/\/$/, "")}/staff>)`,
  ].join("\n");
}

export type LeadHit = {
  name: string | null;
  phone: string | null;
  contact_phone: string | null;
  status: string;
  owner: string | null;
  city: string | null;
  state: string | null;
};

/** /lamp lead: up to five leads, one line each, with who to ask for. */
export function leadsText(query: string, hits: LeadHit[], more: boolean): string {
  if (!hits.length) return `No leads of yours match "${esc(query)}".`;
  const lines = hits.map((h) => {
    const where = [h.city, h.state].filter(Boolean).join(", ");
    const parts = [
      `**${esc(h.name || "Unnamed business")}**${where ? ` (${esc(where)})` : ""}`,
      h.owner ? `ask for ${esc(h.owner)}` : null,
      h.phone ? esc(h.phone) : null,
      h.contact_phone ? `best ${esc(h.contact_phone)}` : null,
      STATUS_WORD[h.status] ?? h.status,
    ].filter(Boolean);
    return `• ${parts.join(" · ")}`;
  });
  return [...lines, more ? "_More match; add a word to narrow it._" : null]
    .filter(Boolean)
    .join("\n");
}

/** Discord ids are snowflakes: 17 to 20 digits. */
export const isDiscordId = (s: unknown): s is string =>
  typeof s === "string" && /^\d{17,20}$/.test(s);

/** Someone in the Lamp Discord server, as the Team tab's matcher shows them. */
export type DiscordMember = { id: string; name: string; username: string };

/**
 * Discord's member list (GET /guilds/{id}/members) as the Team tab needs it: people only (bots
 * left out), named the way the server shows them (server nickname, then display name, then
 * username), each once, A to Z.
 */
export function memberRows(raw: unknown): DiscordMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, DiscordMember>();
  for (const m of raw) {
    const o = (m ?? {}) as { nick?: unknown; user?: unknown };
    const u = (o.user ?? {}) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      bot?: unknown;
    };
    if (u.bot === true || !isDiscordId(u.id) || typeof u.username !== "string") continue;
    const pick = [o.nick, u.global_name, u.username].find(
      (x): x is string => typeof x === "string" && x.trim() !== "",
    )!;
    seen.set(u.id, { id: u.id, name: pick.trim(), username: u.username });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The part of a link token that gets signed: who, and until when (ms). */
export const linkPayload = (discordId: string, expiresMs: number) => `${discordId}.${expiresMs}`;

/** "<discordId>.<expiresMs>.<sig>" taken apart; null when it isn't one or it expired. */
export function readLinkToken(
  token: unknown,
  nowMs = Date.now(),
): { discordId: string; expires: number; sig: string } | null {
  if (typeof token !== "string") return null;
  const m = /^(\d{17,20})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const expires = Number(m[2]);
  if (expires < nowMs) return null;
  return { discordId: m[1]!, expires, sig: m[3]! };
}
