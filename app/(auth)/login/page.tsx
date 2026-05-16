import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { auth, enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Sign in · OpenLen",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = sanitizeNext(next);

  // If already signed in, skip the form and go straight to the app (or the
  // page the user originally tried to reach).
  const session = await auth();
  if (session?.user) {
    redirect(target);
  }

  return (
    <LoginForm
      next={target}
      initialError={error ? "Sign-in failed. Try again." : null}
      oauth={enabledOauthProviders}
    />
  );
}

// Only allow same-origin relative paths so a crafted ?next=https://evil.com
// doesn't bounce the user off-site after sign-in.
function sanitizeNext(next?: string): string {
  if (!next) return "/new";
  if (!next.startsWith("/") || next.startsWith("//")) return "/new";
  return next;
}
