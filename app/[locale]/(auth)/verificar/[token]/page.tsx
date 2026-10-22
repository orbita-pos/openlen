import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/auth/card";
import { verificarCorreo } from "@/lib/auth/verify-email";

// The link in the email sent at sign-up (lib/auth/verify-email.ts). Opening it spends the token and marks
// the address verified; the account already worked before, so either way it leads on to the workspace.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("verify.metaTitle") };
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth" });
  const ok = await verificarCorreo(token).catch((err: unknown) => {
    console.error("[auth/verificar] no se pudo confirmar el correo", err);
    return false;
  });
  return (
    <Card title={ok ? t("verify.ok") : t("verify.invalid")} subtitle={ok ? t("verify.okBody") : t("verify.invalidBody")}>
      <Link
        href="/new"
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-coral-500 px-4 text-sm font-medium text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow"
      >
        {t("verify.continue")} <ArrowRight size={15} />
      </Link>
    </Card>
  );
}
