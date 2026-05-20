import { redirect } from "next/navigation";
import { RegisterForm } from "./register-form";
import { auth, enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Create account · OpenLen",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = sanitizeNext(next);

  // Already signed in? Skip the form. Honor ?next= so a Hero submission
  // with a brief in the URL keeps flowing to /new-v2?mode=ai&brief=…
  const session = await auth();
  if (session?.user) {
    redirect(target);
  }
  return <RegisterForm oauth={enabledOauthProviders} />;
}

function sanitizeNext(raw?: string): string {
  if (!raw) return "/new-v2";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/new-v2";
  return raw;
}
