import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { esDuenoDelProyecto } from "@/lib/voz/dueno";
import { PantallaDeLlamada } from "@/components/llamada/pantalla-de-llamada";

// Hablar con Len por voz. Protegida en el middleware; esto es la segunda puerta,
// la que además comprueba que el proyecto es tuyo.
export default async function LlamadaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { project } = await searchParams;
  const projectId = typeof project === "string" ? project : "";
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: `/login?next=${encodeURIComponent(`/llamada?project=${projectId}`)}`, locale });
  if (!projectId || !(await esDuenoDelProyecto(projectId, userId!))) redirect({ href: "/new?view=projects", locale });
  return <PantallaDeLlamada projectId={projectId} idioma={locale} />;
}
