import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

import { SITE } from "../lib/site";

const SITE_URL = SITE.url;

// Tells search engines what Lamp is: a financial service brokering in NJ and NYC.
const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FinancialService",
  name: SITE.name,
  legalName: SITE.legalName,
  url: SITE.url,
  logo: `${SITE.url}/apple-touch-icon.png`,
  image: `${SITE.url}/og.png`,
  email: SITE.email,
  ...(SITE.phone ? { telephone: SITE.phone } : {}),
  description:
    "Small-business working capital brokerage. Lamp shops a merchant's file to third-party funders and lays the offers out side by side in plain English.",
  areaServed: SITE.areaServed.map((name) => ({ "@type": "AdministrativeArea", name })),
};

function NotFoundComponent() {
  return (
    <div className="lamp-light flex min-h-screen items-center justify-center px-5 font-body text-paper">
      <div className="max-w-md text-center">
        <p className="font-display text-7xl font-bold tabular-nums text-amber">404</p>
        <h1 className="mt-4 font-display text-2xl font-bold">This page is off the map</h1>
        <p className="mt-2 text-mist">The page you're looking for doesn't exist or has moved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="rounded-full bg-amber px-5 py-2.5 font-semibold text-ink transition hover:brightness-105"
          >
            Go home
          </Link>
          <Link
            to="/apply"
            className="rounded-full px-5 py-2.5 font-semibold ring-1 ring-white/20 transition hover:bg-white/5"
          >
            Check my options
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lamp — Working capital, made clear." },
      {
        name: "description",
        content:
          "Lamp is a small-business working capital brokerage. See what you qualify for, in plain terms.",
      },
      { name: "author", content: "Lamp" },
      { name: "theme-color", content: "#231d17" },
      { property: "og:site_name", content: "Lamp" },
      { property: "og:title", content: "Lamp — Working capital, made clear." },
      {
        property: "og:description",
        content:
          "Answer a few questions, see what your business qualifies for, and compare offers side by side in plain English.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${SITE_URL}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE_URL}/og.png` },
      { property: "og:image:alt", content: "Lamp: working capital, made clear." },
    ],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(ORG_JSON_LD) }],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Commissioner:wght@600;700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-paper">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
