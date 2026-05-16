import { ResetForm } from "./reset-form";

export const metadata = {
  title: "Set a new password · Inari Pages",
};

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
