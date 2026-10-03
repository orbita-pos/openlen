// El dueño entra en SU página con su cuenta de OpenLen (plans/page-accounts/design.md).
//
// La página publicada enlaza a `/api/a/owner-start`, que trae aquí. Esto
// corre en openlen.com, donde vive la sesión de OpenLen: comprueba que quien
// llega es el dueño de ese subdominio, crea un código de UN uso y 60 s, y lo
// devuelve a su página (`/api/a/owner`), que lo canjea por la sesión.
// Así no hay una segunda contraseña del dueño por cada sitio.
//
// Es una página y no una ruta de API por el login: su `next` sólo vuelve a
// páginas de la app (lleva el prefijo del idioma), y sin sesión hay que pasar
// por él y volver aquí.

import { redirect as redirectExternal } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { getSubdomainOwner } from "@/lib/projects";
import { publishedUrl } from "@/lib/publish/base-host";
import { safeBackPath } from "@/lib/page-accounts/input";
import { publishedAccounts } from "@/lib/page-accounts/signed-in";
import { createOwnerCode } from "@/lib/page-accounts/store";

export const dynamic = "force-dynamic";

export default async function PageOwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sub: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { locale, sub } = await params;
  setRequestLocale(locale);
  const back = safeBackPath((await searchParams).back);

  const session = await auth();
  if (!session?.user?.id) {
    redirect({ href: `/login?next=${encodeURIComponent(`/page-owner/${sub}?back=${encodeURIComponent(back)}`)}`, locale });
  }
  const userId = session!.user!.id!;

  const t = await getTranslations({ locale, namespace: "auth" });
  const owner = await getSubdomainOwner(sub);
  if (!owner || owner.userId !== userId) {
    return <Message title={t("pageOwner.notOwnerTitle")} body={t("pageOwner.notOwnerBody", { sub })} />;
  }
  if (!(await publishedAccounts(owner.projectId))) {
    return <Message title={t("pageOwner.noAccountsTitle")} body={t("pageOwner.noAccountsBody")} />;
  }

  const code = await createOwnerCode({ projectId: owner.projectId, ownerUserId: userId, email: session!.user!.email ?? "" });
  redirectExternal(
    publishedUrl(sub, `/api/a/owner?code=${code}&back=${encodeURIComponent(back)}`),
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-neutral-600">{body}</p>
    </div>
  );
}
