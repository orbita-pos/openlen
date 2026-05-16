import { LoginForm } from "./login-form";
import { enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Sign in · Inari Pages",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <LoginFormWrapper searchParams={searchParams} />
  );
}

async function LoginFormWrapper({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <LoginForm
      next={next ?? "/new"}
      initialError={error ? "Sign-in failed. Try again." : null}
      oauth={enabledOauthProviders}
    />
  );
}
