import { useState } from "react";
import { ExternalLink, FilePen, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/site";
import { btnOutline, btnPrimary, card } from "@/components/site/layout";
import { chip, input } from "@/components/staff/field-styles";
import { applicationPdfUrl, applicationUrl } from "@/lib/application-links";
import { CopyButton } from "@/components/staff/send-applications";
import { postInvites } from "@/lib/post-invites";
import { fillInUrl, phoneStartProblem, type PhoneStart } from "@/lib/phone-start";

/**
 * The rep's two public application links, side by side for an A/B test: the online application
 * (fill in and sign on the page, the signed file lands in the rep's files) and the PDF (the whole
 * form on one page, sent back however the merchant likes). Admins can pick any rep's links.
 */
export function AppLinks({
  isAdmin,
  repSlug,
  reps,
}: {
  isAdmin: boolean;
  repSlug: string | null;
  reps: { slug: string; name: string }[];
}) {
  const [picked, setPicked] = useState(repSlug ?? "");
  const slug = isAdmin ? picked : (repSlug ?? "");
  if (!slug && !isAdmin) return null;

  const links = slug
    ? [
        {
          tag: "A",
          title: "Online application",
          note: "Step by step: they fill it in and sign. The signed file lands in your files.",
          url: applicationUrl(SITE.url, slug),
          // staff browsers aren't counted on the online page
          open: applicationUrl(SITE.url, slug),
        },
        {
          tag: "B",
          title: "PDF application",
          note: "The whole form on one page: they fill it in and sign right on it. The signed file lands in your files.",
          url: applicationPdfUrl(SITE.url, slug),
          // staff browsers aren't counted on either page
          open: applicationPdfUrl(SITE.url, slug),
        },
      ]
    : [];

  return (
    <section className="mt-5" data-app-links>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-smoke">
          Application links
        </h2>
        {isAdmin && (
          <select
            aria-label="Whose links"
            className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-line"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Pick a rep</option>
            {reps.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
                {r.slug === repSlug ? " (you)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      {links.length > 0 && (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {links.map((l) => (
            <div key={l.tag} className={cn(card, "p-4")} data-app-link={l.tag}>
              <p className="text-sm font-semibold">
                <span className="mr-2 rounded-full bg-ink px-2 py-0.5 text-xs text-white">
                  {l.tag}
                </span>
                {l.title}
              </p>
              <p className="mt-1 text-xs text-smoke">{l.note}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  aria-label={`${l.title} link`}
                  className={cn(input, "min-w-0 basis-full font-mono text-xs sm:basis-0 sm:flex-1")}
                  value={l.url.replace(/^https:\/\//, "")}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton text={l.url} />
                <a className={chip} href={l.open} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      {slug && <PhoneStartBox repSlug={isAdmin ? slug : null} />}
      {isAdmin && links.length > 0 && (
        <p className="mt-2 text-xs text-smoke">
          Dashboard → Website → Application links shows, for each link, how many people opened it,
          how many signed, and signed per opener.
        </p>
      )}
    </section>
  );
}

const EMPTY: PhoneStart = { email: "", phone: "", first_name: "", business_name: "" };

/**
 * On the phone with someone who isn't in your leads: get their email first, then either email
 * them their own application link to finish when they have time, or open it and fill it in
 * together on the call (with "Email it to them to finish" at the top if the call gets cut short).
 * Either way the link is theirs, tracked under Applications, and the signed file lands with you.
 */
function PhoneStartBox({ repSlug }: { repSlug: string | null }) {
  const [p, setP] = useState<PhoneStart>(EMPTY);
  const [busy, setBusy] = useState<"email" | "fill" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tried, setTried] = useState(false);
  const problem = phoneStartProblem(p);
  const set = (k: keyof PhoneStart) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setP((x) => ({ ...x, [k]: e.target.value }));
    setMsg(null);
  };

  async function go(channel: "email" | "link") {
    setTried(true);
    if (problem) return;
    // opened now, while the click still counts, so the browser doesn't block it as a popup
    const tab = channel === "link" ? window.open("about:blank", "_blank") : null;
    setBusy(channel === "email" ? "email" : "fill");
    setMsg(null);
    try {
      const [res] = await postInvites({
        action: "send",
        ...(repSlug ? { rep_slug: repSlug } : {}),
        recipients: [
          {
            first_name: p.first_name.trim(),
            business_name: p.business_name.trim(),
            email: p.email.trim().toLowerCase(),
            phone: p.phone.trim(),
            channel,
          },
        ],
      });
      if (channel === "email") {
        if (res?.status !== "sent") throw new Error(res?.detail || "Couldn't send it.");
        setMsg({
          ok: true,
          text: `Sent to ${p.email.trim().toLowerCase()}. It's under Applications, with when they open, start and sign it.`,
        });
        setP(EMPTY);
        setTried(false);
      } else {
        if (!res?.url) throw new Error(res?.detail || "Couldn't make the application link.");
        const url = fillInUrl(res.url);
        if (tab) tab.location.href = url;
        else window.location.href = url;
        setMsg({
          ok: true,
          text: "Opened in a new tab. Fill it in with them. If they have to go, press Email it to them to finish at the top.",
        });
      }
    } catch (e) {
      tab?.close();
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't do that. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn(card, "mt-3 p-4")} data-phone-start>
      <p className="text-sm font-semibold">On the phone with someone new?</p>
      <p className="mt-1 text-xs text-smoke">
        Not in your leads? Get their email first. Then email them their own application to finish
        when they have time, or fill it in with them now.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className={input}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="Their email (first)"
          aria-label="Their email"
          value={p.email}
          onChange={set("email")}
          data-phone-start-email
        />
        <input
          className={input}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="Their cell"
          aria-label="Their cell"
          value={p.phone}
          onChange={set("phone")}
          data-phone-start-phone
        />
        <input
          className={input}
          autoComplete="off"
          placeholder="First name"
          aria-label="First name"
          value={p.first_name}
          onChange={set("first_name")}
          data-phone-start-name
        />
        <input
          className={input}
          autoComplete="off"
          placeholder="Business"
          aria-label="Business"
          value={p.business_name}
          onChange={set("business_name")}
          data-phone-start-business
        />
      </div>
      {tried && problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
      {msg && (
        <p
          className={cn("mt-2 text-sm", msg.ok ? "text-forest" : "text-destructive")}
          role="status"
        >
          {msg.text}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(btnPrimary, "px-5 py-2")}
          disabled={busy !== null}
          onClick={() => void go("email")}
          data-phone-start-send
        >
          {busy === "email" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          Email them the application
        </button>
        <button
          type="button"
          className={cn(btnOutline, "px-5 py-2")}
          disabled={busy !== null}
          onClick={() => void go("link")}
          data-phone-start-fill
        >
          {busy === "fill" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FilePen className="size-4" />
          )}
          Fill it in with them now
        </button>
      </div>
    </div>
  );
}
