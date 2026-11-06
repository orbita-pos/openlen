import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { RegisterForm } from "./register-form";
import { auth, enabledOauthProviders } from "@/auth";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("register.metaTitle") };
}

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next } = await searchParams;
  const target = sanitizeNext(next);

  // Already signed in? Skip the form. Honor ?next= so a Hero submission
  // with a brief in the URL keeps flowing to /new?mode=ai&brief=…
  const session = await auth();
  if (session?.user) {
    redirect({ href: target, locale });
  }
  return <RegisterForm oauth={enabledOauthProviders} />;
}

function sanitizeNext(raw?: string): string {
  // Home, not /new: the home's box is the only one (06/11).
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
