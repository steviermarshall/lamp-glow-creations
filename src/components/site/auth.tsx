import { getSupabase } from "@/lib/supabase";
import { authRedirectUrl } from "@/hooks/use-auth";

export async function signInWithGoogle(next = "/account") {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign-in isn't available yet.");
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authRedirectUrl(next) },
  });
  if (error) throw error;
}

export async function sendMagicLink(email: string, firstName?: string, next = "/account") {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign-in isn't available yet.");
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authRedirectUrl(next),
      shouldCreateUser: true,
      ...(firstName ? { data: { first_name: firstName } } : {}),
    },
  });
  if (error) throw error;
}

export function GoogleButton({
  onClick,
  label = "Continue with Google",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-4 text-base font-semibold text-ink ring-1 ring-line transition hover:-translate-y-0.5"
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z"
        />
        <path
          fill="#EA4335"
          d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
        />
      </svg>
      {label}
    </button>
  );
}
