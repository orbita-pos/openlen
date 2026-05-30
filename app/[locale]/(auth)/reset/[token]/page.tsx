import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetForm } from "./reset-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("reset.metaTitle") };
}

export default async function ResetPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  return <ResetForm token={token} />;
}
