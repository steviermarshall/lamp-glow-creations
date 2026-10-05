import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { SITE, telHref } from "@/lib/site";

// Buttons. Primary is the lamp: amber with ink text. Ghost sits on dark ground, outline on paper.
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-amber px-6 py-3.5 text-[0.95rem] font-semibold text-ink shadow-[0_8px_24px_-10px_oklch(0.8_0.145_72/0.8)] transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[0.95rem] font-semibold text-paper ring-1 ring-white/20 transition hover:bg-white/5 disabled:pointer-events-none disabled:opacity-50";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-[0.95rem] font-semibold text-ink ring-1 ring-line transition hover:ring-ink/30 disabled:pointer-events-none disabled:opacity-50";

// Surfaces. A card is a sheet of paper on the cream ground; cardDark is a panel on ink.
export const card = "rounded-2xl border border-line bg-white";
export const cardDark = "rounded-2xl border border-white/10 bg-ink-2";

export function LampMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const box = size === "lg" ? "size-9 rounded-[11px]" : "size-7 rounded-[9px]";
  const dot = size === "lg" ? "size-3.5" : "size-2.5";
  return (
    <span
      className={cn("grid place-items-center bg-ink-2 ring-1 ring-white/10", box)}
      aria-hidden="true"
    >
      <span
        className={cn("rounded-full bg-amber shadow-[0_0_14px_3px_oklch(0.8_0.145_72/0.65)]", dot)}
      />
    </span>
  );
}

export function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <span className="flex items-center gap-2.5">
      <LampMark size={size} />
      <span
        className={cn(
          "font-display font-bold tracking-tight text-paper",
          size === "lg" ? "text-xl" : "text-lg",
        )}
      >
        Lamp
      </span>
    </span>
  );
}

const NAV = [
  { label: "How it works", to: "/how-it-works" },
  { label: "Offer Check", to: "/offer-check" },
  { label: "Funding options", to: "/", hash: "options" },
  { label: "FAQ", to: "/faq" },
  { label: "About", to: "/about" },
] as const;

export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-6">
        <Link to="/" aria-label="Lamp home" className="rounded-lg">
          <Wordmark />
        </Link>

        {!minimal && (
          <nav
            aria-label="Main"
            className="hidden items-center gap-8 text-[0.95rem] font-medium text-mist md:flex"
          >
            {NAV.map((n) => (
              <Link
                key={n.label}
                to={n.to}
                {...("hash" in n ? { hash: n.hash } : {})}
                className="transition hover:text-paper"
                activeProps={{ className: "text-paper" }}
                activeOptions={{ includeHash: true }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <Link
            to={user ? "/account" : "/login"}
            className="hidden rounded-full px-4 py-2.5 text-[0.95rem] font-semibold text-mist transition hover:text-paper sm:inline-flex"
          >
            {user ? "My account" : "Sign in"}
          </Link>
          {!minimal && (
            <Link to="/apply" className={cn(btnPrimary, "hidden px-5 py-2.5 sm:inline-flex")}>
              Check my options
            </Link>
          )}
          {!minimal && (
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-paper ring-1 ring-white/20 md:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          )}
        </div>
      </div>

      {open && (
        <nav aria-label="Mobile" className="border-t border-white/10 px-5 pb-6 pt-2 md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              {...("hash" in n ? { hash: n.hash } : {})}
              onClick={() => setOpen(false)}
              className="block border-b border-white/10 py-4 text-base font-medium text-paper"
            >
              {n.label}
            </Link>
          ))}
          <Link
            to={user ? "/account" : "/login"}
            onClick={() => setOpen(false)}
            className="block border-b border-white/10 py-4 text-base font-medium text-paper"
          >
            {user ? "My account" : "Sign in"}
          </Link>
          <Link
            to="/apply"
            onClick={() => setOpen(false)}
            className={cn(btnPrimary, "mt-5 w-full")}
          >
            Check my options
          </Link>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-ink text-mist">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Wordmark size="sm" />
          <p className="mt-4 max-w-xs text-[0.95rem] leading-relaxed">
            Working capital for owner-operators in New Jersey and New York City, explained in plain
            English.
          </p>
          <ul className="mt-5 space-y-1.5 text-[0.95rem]">
            <li>
              <a
                className="text-paper underline-offset-4 hover:underline"
                href={`mailto:${SITE.email}`}
              >
                {SITE.email}
              </a>
            </li>
            {SITE.phone && (
              <li>
                <a
                  className="text-paper underline-offset-4 hover:underline"
                  href={telHref(SITE.phone)}
                >
                  {SITE.phone}
                </a>
              </li>
            )}
            {SITE.address && <li>{SITE.address}</li>}
          </ul>
        </div>
        <FooterCol
          title="Get funded"
          links={[
            { label: "Check my options", to: "/apply" },
            { label: "How it works", to: "/how-it-works" },
            { label: "Check an offer you have", to: "/offer-check" },
            { label: "Funding options", to: "/", hash: "options" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: "About", to: "/about" },
            { label: "FAQ", to: "/faq" },
            { label: "For funders & ISOs", to: "/", hash: "for-funders" },
          ]}
        />
        <FooterCol
          title="Legal"
          links={[
            { label: "Privacy policy", to: "/privacy" },
            { label: "Terms of use", to: "/terms" },
          ]}
        />
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-5 py-6 text-[0.8rem] leading-relaxed text-mist/80 sm:px-6">
          © {new Date().getFullYear()} {SITE.legalName}. Lamp is a brokerage, not a lender. We
          arrange offers through a network of third-party funders, and every offer is subject to
          that funder's review and approval. Estimates on this site are for illustration only and
          are not offers or commitments to fund.
        </p>
      </div>
    </footer>
  );
}

type FooterLink = { label: string; to: string; hash?: string };

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist/70">{title}</p>
      <ul className="mt-4 space-y-3 text-[0.95rem]">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              to={l.to}
              {...(l.hash ? { hash: l.hash } : {})}
              className="transition hover:text-paper"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageShell({
  children,
  minimalHeader = false,
  footer = true,
}: {
  children: ReactNode;
  minimalHeader?: boolean;
  footer?: boolean;
}) {
  return (
    <div className="font-body relative flex min-h-screen flex-col overflow-x-clip bg-paper text-ink antialiased">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-amber px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader minimal={minimalHeader} />
      <main id="main" className="flex-1">
        {children}
      </main>
      {footer && <SiteFooter />}
    </div>
  );
}

/** Simple long-form page (about / legal). */
export function ProsePage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <PageShell>
      <section className="lamp-light text-paper">
        <div className="mx-auto max-w-3xl px-5 pb-14 pt-14 sm:px-6 sm:pt-20">
          <Eyebrow dark>{eyebrow}</Eyebrow>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {title}
          </h1>
          {intro && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist">{intro}</p>}
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-4 sm:px-6">
        <div className="prose-lamp">{children}</div>
      </section>
    </PageShell>
  );
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]",
        dark ? "text-amber" : "text-amber-deep",
      )}
    >
      <span className="size-1.5 rounded-full bg-amber shadow-[0_0_8px_2px_oklch(0.8_0.145_72/0.6)]" />
      {children}
    </span>
  );
}
