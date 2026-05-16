import { redirect } from "next/navigation";
import { RegisterForm } from "./register-form";
import { auth, enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Create account · Inari Pages",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = sanitizeNext(next);

  // Already signed in? Skip the form. Honor ?next= so a Hero submission
  // with a brief in the URL keeps flowing to /new?brief=…
  const session = await auth();
  if (session?.user) {
    redirect(target);
  }
  return <RegisterForm oauth={enabledOauthProviders} />;
}

function sanitizeNext(raw?: string): string {
  if (!raw) return "/new";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/new";
  return raw;
}
