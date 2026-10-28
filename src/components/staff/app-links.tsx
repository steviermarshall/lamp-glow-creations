import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/site";
import { card } from "@/components/site/layout";
import { chip, input } from "@/components/staff/field-styles";
import { applicationPdfUrl, applicationUrl } from "@/lib/application-links";
import { CopyButton } from "@/components/staff/send-applications";

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
      {isAdmin && links.length > 0 && (
        <p className="mt-2 text-xs text-smoke">
          Under Dashboard → Website → Page: /application/&lt;rep&gt; and …/pdf are opens, …/signed
          are signed files.
        </p>
      )}
    </section>
  );
}
