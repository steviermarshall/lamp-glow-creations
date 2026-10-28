import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";
import { useAuth } from "@/hooks/use-auth";
import { getSupabase } from "@/lib/supabase";
import { SITE, telHref } from "@/lib/site";
import { LampField } from "@/components/site/lamp-field";
import { LampOrb } from "@/components/site/lamp-orb";
import { useLamplightGlass } from "@/components/site/lamp-lens";

// Buttons. Primary is the lamp: leaf green with ink text. Ghost sits on dark ground, outline on paper.
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-leaf px-6 py-3.5 text-[0.95rem] font-semibold text-ink shadow-[0_8px_24px_-10px_oklch(0.615_0.117_150/0.8)] transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[0.95rem] font-semibold text-paper ring-1 ring-white/20 transition hover:bg-white/5 disabled:pointer-events-none disabled:opacity-50";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-[0.95rem] font-semibold text-ink ring-1 ring-line transition hover:ring-ink/30 disabled:pointer-events-none disabled:opacity-50";

// Surfaces. A card is a sheet of paper on the cream ground; cardDark is a panel on ink.
export const card = "rounded-2xl border border-line bg-white";
export const cardDark = "rounded-2xl border border-white/10 bg-ink-2";

export function LampMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const box = size === "lg" ? "size-9 rounded-[11px]" : "size-7 rounded-[9px]";
  const orb = size === "lg" ? "size-6" : "size-5";
  return (
    <span
      className={cn("grid place-items-center bg-forest ring-1 ring-white/10", box)}
      aria-hidden="true"
    >
      <LampOrb className={orb} variant="mark" />
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
        Lamp<span className="text-leaf">.</span>
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

export function SiteHeader({
  minimal = false,
  floating = false,
  themeToggle = false,
}: {
  minimal?: boolean;
  /** The light/dark switch: member pages only (staff portal, account, application links). */
  themeToggle?: boolean;
  /** Lamplight pages: a glass bar floating over the dot field instead of a full-width band. */
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header
      className={cn(
        "sticky top-0 z-40",
        floating ? "px-3 pt-3 sm:px-4" : "border-b border-white/10 bg-ink/95 backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between",
          floating ? "ll-glass rounded-[1.4rem] py-2.5 pl-4 pr-2.5 sm:pl-5" : "px-5 py-3.5 sm:px-6",
        )}
      >
        <Link to="/" aria-label="Lamp home" className="rounded-lg">
          <Wordmark />
        </Link>

        {!minimal && (
          <nav
            aria-label="Main"
            className={cn(
              "hidden items-center text-mist md:flex",
              floating
                ? "gap-6 font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em]"
                : "gap-8 text-[0.95rem] font-medium",
            )}
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
          {themeToggle && <ThemeToggle />}
          <Link
            to={user ? "/account" : "/login"}
            className="hidden rounded-full px-4 py-2.5 text-[0.95rem] font-semibold text-mist transition hover:text-paper sm:inline-flex"
          >
            {user ? "My account" : "Sign in"}
          </Link>
          {user && <SignOut />}
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
        <nav
          aria-label="Mobile"
          className={cn(
            "px-5 pb-6 pt-2 md:hidden",
            floating
              ? "mx-auto mt-2 max-w-6xl rounded-[1.4rem] bg-night/90 ring-1 ring-white/10 backdrop-blur-xl"
              : "border-t border-white/10",
          )}
        >
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

/** Signed in anywhere on the site (staff included, whom /account sends back to /staff): sign out. */
function SignOut() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[0.95rem] font-semibold text-mist ring-1 ring-white/20 transition hover:text-paper sm:px-4"
      aria-label="Sign out"
      title="Sign out"
      data-sign-out
      onClick={async () => {
        await getSupabase()?.auth.signOut();
        navigate({ to: "/" });
      }}
    >
      <LogOut className="size-4" />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}

/** Sun in dark mode, moon in light mode. Both icons render on the server; CSS shows the right one. */
function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);
  useEffect(() => setThemeState(currentTheme()), []);
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="grid size-11 place-items-center rounded-full text-mist ring-1 ring-white/20 transition hover:text-paper"
      aria-label={theme ? `Switch to ${next} mode` : "Switch light or dark mode"}
      title={theme ? `Switch to ${next} mode` : undefined}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      <Sun className="ll-when-dark size-[1.15rem]" aria-hidden="true" />
      <Moon className="ll-when-light size-[1.15rem]" aria-hidden="true" />
    </button>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-ink text-mist">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Wordmark size="sm" />
          <p className="mt-4 max-w-xs text-[0.95rem] leading-relaxed">
            Working capital for owner-operators across the U.S., explained in plain English.
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
  tone = "paper",
  member = false,
  themeToggle,
}: {
  children: ReactNode;
  minimalHeader?: boolean;
  footer?: boolean;
  /**
   * The Lamplight look (green-black ground, glass panels, the orb). "night" adds the live dot field
   * and glass refraction (public pages, apply, login); "night-calm" keeps the same look still and
   * with more solid panels (merchant account, staff portal), so forms and tables stay readable.
   * Both re-map the app's light classes (white cards, ink text, hairlines) in styles.css.
   */
  tone?: "paper" | "night" | "night-calm";
  /**
   * Pages for members (staff portal, a merchant's account, the application link): they get the
   * light/dark switch and follow it. The public site always stays in the green night look.
   */
  member?: boolean;
  /** Show the light/dark switch. Defaults to member; the application link turns it off. */
  themeToggle?: boolean;
}) {
  const live = tone === "night";
  const night = live || tone === "night-calm";
  useLamplightGlass(live);
  return (
    <div
      className={cn(
        "font-body relative flex min-h-screen flex-col overflow-x-clip antialiased",
        night
          ? cn(
              "ll-night isolate bg-night text-paper",
              live ? "ll-live" : "ll-calm",
              member && "ll-member",
            )
          : "bg-paper text-ink",
      )}
    >
      {night && (
        <>
          {live && <LampField />}
          <div aria-hidden="true" className="ll-atmos pointer-events-none fixed inset-0 -z-20" />
        </>
      )}
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-leaf px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader minimal={minimalHeader} floating={night} themeToggle={themeToggle ?? member} />
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
    <PageShell tone="night">
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
        dark ? "text-leaf" : "text-forest",
      )}
    >
      <span className="size-1.5 rounded-full bg-leaf shadow-[0_0_8px_2px_oklch(0.615_0.117_150/0.6)]" />
      {children}
    </span>
  );
}
