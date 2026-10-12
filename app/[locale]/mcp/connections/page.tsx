// «APLICACIONES CONECTADAS» (plans/mcp-de-openlen, Parte 4): las conexiones MCP
// de la persona y sus tokens personales. Con la sesión de la web; sin ella, al
// login y de vuelta aquí.
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { ConnectionsView } from "@/components/mcp/connections-view";
import { Link, redirect } from "@/i18n/navigation";
import { mcpResourceUrl } from "@/lib/mcp/config";
import { listConnections } from "@/lib/mcp/connections";
import { projectsVisibleTo } from "@/lib/mcp/projects-list";

export const dynamic = "force-dynamic";

export default async function McpConnectionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects.mcpConnections" });
  const userId = (await auth())?.user?.id;
  if (!userId) redirect({ href: "/login?next=/mcp/connections", locale });
  const [connections, visible] = await Promise.all([listConnections(userId!), projectsVisibleTo(userId!)]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm opacity-70">{t("intro")}</p>
        <Link href="/mcp" className="text-sm underline">
          {t("installLink")}
        </Link>
      </header>
      <ConnectionsView
        locale={locale}
        mcpUrl={mcpResourceUrl()}
        projects={visible.map(({ p }) => ({ id: p.id, title: p.title }))}
        initial={connections.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          verified: c.verified,
          clientHost: c.clientHost,
          scopes: c.scopes,
          projectTitle: c.projectTitle,
          createdAt: c.createdAt.toISOString(),
          lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
          expiresAt: c.expiresAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
