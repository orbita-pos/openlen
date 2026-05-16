import { redirect } from "next/navigation";
import { RegisterForm } from "./register-form";
import { auth, enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Create account · Inari Pages",
};

export default async function RegisterPage() {
  // Already signed in? Skip register, go to the app.
  const session = await auth();
  if (session?.user) {
    redirect("/new");
  }
  return <RegisterForm oauth={enabledOauthProviders} />;
}
