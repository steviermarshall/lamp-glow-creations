// One place for the facts the whole site repeats. Leave a field empty and the site hides it,
// so nothing placeholder-looking ever ships.

export const SITE = {
  name: "Lamp",
  legalName: "Lamp Financial Group LLC",
  url: "https://getlamp.app",
  email: "hello@getlamp.app",
  partnersEmail: "partners@getlamp.app",
  /** Display format, e.g. "(908) 555-0123". Empty = hidden. */
  phone: "",
  /** Mailing address for the footer, e.g. "123 Main St, Roselle, NJ 07203". Empty = hidden. */
  address: "",
  areaServed: ["New Jersey", "New York City"],
} as const;

export const telHref = (phone: string) => `tel:+1${phone.replace(/\D/g, "").slice(-10)}`;

// ---------- Rep links: /apply/<slug> ----------
// Anything that comes in through a rep's link is tagged with ref=<slug> on the application.

export type Rep = { slug: string; name: string; title?: string; photo?: string };

export const REPS: Rep[] = [
  { slug: "stevie", name: "Stevie Marshall", title: "Founder" },
  { slug: "zeus", name: "Zeus" },
  { slug: "asad", name: "Asad" },
];

export const findRep = (slug: string | undefined) =>
  REPS.find((r) => r.slug === slug?.toLowerCase());

// ---------- Per-page head tags ----------

export function seo({
  path,
  title,
  description,
  noindex = false,
}: {
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
}) {
  const url = `${SITE.url}${path === "/" ? "" : path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      ...(noindex ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
