import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LoginForm } from "./login-form";
import { auth, enabledOauthProviders } from "@/auth";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("login.metaTitle") };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next, error } = await searchParams;
  const target = sanitizeNext(next);

  // If already signed in, skip the form and go straight to the app (or the
  // page the user originally tried to reach).
  const session = await auth();
  if (session?.user) {
    redirect({ href: target, locale });
  }

  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <LoginForm
      next={target}
      initialError={error ? t("login.errors.signInFailed") : null}
      oauth={enabledOauthProviders}
    />
  );
}

// Only allow same-origin relative paths so a crafted ?next=https://evil.com
// doesn't bounce the user off-site after sign-in.
function sanitizeNext(next?: string): string {
  // Home, not /new: the home's box is the only one (06/11).
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
