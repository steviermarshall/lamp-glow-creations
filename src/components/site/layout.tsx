import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink shadow-lg shadow-aurora-a/20 transition hover:-translate-y-0.5 hover:shadow-aurora-a/40 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/5 disabled:pointer-events-none disabled:opacity-50";
export const card = "rounded-2xl border border-white/10 bg-panel/60 backdrop-blur-xl";

export function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const box = size === "lg" ? "size-9 rounded-xl" : "size-7 rounded-lg";
  const dot = size === "lg" ? "size-3" : "size-2";
  const text = size === "lg" ? "text-xl" : "text-base";
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`grid ${box} place-items-center bg-gradient-to-br from-aurora-a via-aurora-b to-aurora-c shadow-lg shadow-aurora-b/30`}
      >
        <span className={`${dot} rounded-full bg-ink/85`} />
      </span>
      <span className={`font-display ${text} font-bold tracking-tight`}>Lamp</span>
    </span>
  );
}

const NAV = [
  { label: "How it works", to: "/", hash: "how-it-works" },
  { label: "Funding options", to: "/", hash: "options" },
  { label: "FAQ", to: "/faq" },
  { label: "About", to: "/about" },
] as const;

export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
        <Link to="/" aria-label="Lamp home">
          <Wordmark />
        </Link>

        {!minimal && (
          <nav className="hidden items-center gap-8 text-sm font-medium text-mist md:flex">
            {NAV.map((n) => (
              <Link
                key={n.label}
                to={n.to}
                {...("hash" in n ? { hash: n.hash } : {})}
                className="transition hover:text-white"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <Link
            to={user ? "/account" : "/login"}
            className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-white sm:inline-flex"
          >
            {user ? "My account" : "Sign in"}
          </Link>
          {!minimal && (
            <Link
              to="/apply"
              className="hidden rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 sm:inline-flex"
            >
              Check my options
            </Link>
          )}
          {!minimal && (
            <button
              type="button"
              className="grid size-10 place-items-center rounded-full text-white ring-1 ring-white/15 md:hidden"
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
        <nav className="border-t border-white/5 px-5 pb-6 pt-2 md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              {...("hash" in n ? { hash: n.hash } : {})}
              onClick={() => setOpen(false)}
              className="block border-b border-white/5 py-4 text-base font-medium text-white"
            >
              {n.label}
            </Link>
          ))}
          <Link
            to={user ? "/account" : "/login"}
            onClick={() => setOpen(false)}
            className="block border-b border-white/5 py-4 text-base font-medium text-white"
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
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark size="sm" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist/80">
            Working capital for owner-operators in New Jersey and New York City, explained in plain
            English.
          </p>
        </div>
        <FooterCol
          title="Get funded"
          links={[
            { label: "Check my options", to: "/apply" },
            { label: "Funding options", to: "/", hash: "options" },
            { label: "How it works", to: "/", hash: "how-it-works" },
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
      <div className="border-t border-white/5">
        <p className="mx-auto max-w-6xl px-5 py-6 text-xs leading-relaxed text-mist/60 sm:px-6">
          © {new Date().getFullYear()} Lamp Financial Group LLC. Lamp is a brokerage, not a lender.
          We arrange offers through a network of third-party funders, and every offer is subject to
          that funder's review and approval. Estimates shown on this site are for illustration only
          and are not offers or commitments to lend.
        </p>
      </div>
    </footer>
  );
}

type FooterLink = { label: string; to: string; hash?: string };

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mist/60">{title}</p>
      <ul className="mt-4 space-y-3 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              to={l.to}
              {...(l.hash ? { hash: l.hash } : {})}
              className="text-mist transition hover:text-white"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="aurora-blob absolute -left-40 -top-52 h-[440px] w-[440px] rounded-full bg-aurora-a/35 blur-[130px]" />
      <div className="aurora-blob-b absolute right-[-12%] top-[-6%] h-[520px] w-[520px] rounded-full bg-aurora-b/35 blur-[140px]" />
      <div className="aurora-blob-c absolute bottom-[-20%] left-1/3 h-[480px] w-[480px] rounded-full bg-aurora-c/20 blur-[150px]" />
      <div className="grid-fade absolute inset-0" />
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
    <div className="font-body relative min-h-screen overflow-x-clip bg-ink text-white antialiased">
      <Aurora />
      <div className="relative flex min-h-screen flex-col">
        <SiteHeader minimal={minimalHeader} />
        <main className="flex-1">{children}</main>
        {footer && <SiteFooter />}
      </div>
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
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:px-6 sm:pt-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        {intro && <p className="mt-5 text-lg leading-relaxed text-mist">{intro}</p>}
        <div className="prose-lamp mt-10">{children}</div>
      </section>
    </PageShell>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-mist ring-1 ring-white/10">
      <span className="size-1.5 rounded-full bg-aurora-a" /> {children}
    </span>
  );
}
