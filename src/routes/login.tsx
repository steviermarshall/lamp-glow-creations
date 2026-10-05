import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Mail } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/site";
import { btnOutline, card, PageShell } from "@/components/site/layout";
import { GoogleButton, sendMagicLink, signInWithGoogle } from "@/components/site/auth";

export const Route = createFileRoute("/login")({
  head: () =>
    seo({
      path: "/login",
      title: "Sign in — Lamp",
      description: "Check on your Lamp file and your offers.",
      noindex: true,
    }),
  component: Login,
});

function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) navigate({ to: "/account" });
  }, [user, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      await sendMagicLink(email.trim().toLowerCase());
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <PageShell minimalHeader footer={false}>
      <div className="mx-auto max-w-md px-5 pb-20 pt-12 sm:pt-20">
        <div className={cn(card, "rise p-6 sm:p-8")}>
          <h1 className="font-display text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-smoke">Sign in to check on your file and your offers.</p>

          {!isSupabaseConfigured ? (
            <p className="mt-6 rounded-xl bg-sand p-4 text-sm text-smoke ring-1 ring-line">
              Online accounts are being set up. Email{" "}
              <a className="font-semibold text-ink underline" href="mailto:hello@getlamp.app">
                hello@getlamp.app
              </a>{" "}
              and we'll help right away.
            </p>
          ) : status === "sent" ? (
            <div className="mt-6 rounded-2xl bg-amber/10 p-5 ring-1 ring-amber/40">
              <Mail className="size-6 text-amber-deep" />
              <p className="mt-3 font-semibold">Check your inbox</p>
              <p className="mt-1 text-sm text-smoke">
                We sent a sign-in link to <strong className="text-ink">{email}</strong>.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <GoogleButton onClick={() => signInWithGoogle()} />
              <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-smoke">
                <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
              </div>
              <form onSubmit={submit} className="space-y-3">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  aria-label="Email address"
                  className="w-full rounded-xl bg-white px-4 py-3.5 text-base text-ink ring-1 ring-line placeholder:text-smoke/60 focus:outline-none focus:ring-2 focus:ring-sky"
                />
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className={cn(btnOutline, "w-full py-4 text-base")}
                >
                  {status === "sending" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                  Email me a sign-in link
                </button>
              </form>
              {status === "error" && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          <p className="mt-8 text-center text-sm text-smoke">
            New to Lamp?{" "}
            <Link to="/apply" className="font-semibold text-amber-deep">
              Check your options first
            </Link>
          </p>
        </div>
      </div>
    </PageShell>
  );
}
