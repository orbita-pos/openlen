import { RegisterForm } from "./register-form";
import { enabledOauthProviders } from "@/auth";

export const metadata = {
  title: "Create account · Inari Pages",
};

export default function RegisterPage() {
  return <RegisterForm oauth={enabledOauthProviders} />;
}
