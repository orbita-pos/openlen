// LA PANTALLA DE CONSENTIMIENTO DEL MCP (Parte 3). Con la sesión de la web:
// sin ella, al login y de vuelta aquí. Dice QUIÉN pide, a DÓNDE vuelve y QUÉ
// podrá hacer; la persona elige permisos y proyecto.
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { projectsVisibleTo } from "@/lib/mcp/projects-list";
import { getPendingRequest } from "@/lib/mcp/oauth/consent";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export default async function McpConsentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects.mcpConsent" });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: `/login?next=/oauth/consent/${encodeURIComponent(id)}`, locale });
  const req = await getPendingRequest(id);
  if (!req) return <Shell>{t("notFound")}</Shell>;
  if (req.status !== "pending") return <Shell>{t("used")}</Shell>;
  if (req.expiresAt.getTime() <= Date.now()) return <Shell>{t("expired")}</Shell>;
  const back = new URL(req.redirectUri);
  const loopback = back.protocol === "http:";
  const projects = (await projectsVisibleTo(userId!)).map(({ p }) => ({ id: p.id, title: p.title }));
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("title", { client: req.clientName })}</h1>
      <p className="text-sm opacity-70">
        {req.clientKind === "cimd" ? t("verifiedBy", { host: new URL(req.clientId).host }) : t("unverified")}
      </p>
      <p className="text-sm opacity-70">{t("returnsTo", { host: back.host || back.protocol })}</p>
      {loopback ? <p className="rounded-lg border px-4 py-3 text-sm">{t("localhost")}</p> : null}
      <p className="text-sm opacity-70">{t("signedInAs", { email: session?.user?.email ?? "" })}</p>
      <ConsentForm id={id} asked={req.scopes} projects={projects} />
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-12 text-base">{children}</main>;
}
