// LA APROBACIÓN DE UN AGENTE DE FUERA (plans/mcp-de-openlen, Parte 2). Con la
// sesión de la web: sin ella, al login y de vuelta aquí. Sólo la persona para
// la que se pidió la ve; para cualquier otra, «no existe».
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { db, schema } from "@/lib/db";
import { getApprovalForUser } from "@/lib/mcp/approvals";
import { tokenName } from "@/lib/mcp/tokens";
import { deployUrlFor } from "@/lib/publish/deploy-url";
import { Decision } from "./decision";

export const dynamic = "force-dynamic";

export default async function McpApprovalPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects.mcpApproval" });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: `/login?next=/mcp/approve/${encodeURIComponent(id)}`, locale });
  const approval = await getApprovalForUser(id, userId!);
  if (!approval) return <Shell title={t("title")} message={t("notFound")} />;
  const [project] = await db
    .select({ title: schema.projects.title, subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(eq(schema.projects.id, approval.projectId))
    .limit(1);
  const name = (await tokenName(approval.tokenId)) ?? "MCP";
  const url = deployUrlFor(approval.action === "publish" ? approval.subdomain : project?.subdomain ?? null) ?? "—";
  const what = approval.action === "publish"
    ? t("publish", { project: project?.title ?? "—", url })
    : t("unpublish", { project: project?.title ?? "—", url });
  const state =
    approval.status === "used" ? "used"
    : approval.status === "denied" ? "denied"
    : approval.status === "approved" ? "approved"
    : approval.expiresAt.getTime() <= Date.now() ? "expired"
    : "pending";
  return (
    <Shell title={t("title")}>
      <p className="text-lg font-medium">{what}</p>
      <p className="text-sm opacity-70">{t("requestedBy", { name })}</p>
      {state === "pending" ? (
        <>
          <p className="text-sm opacity-70">{t("expires", { when: approval.expiresAt.toLocaleString(locale) })}</p>
          <p className="rounded-lg border px-4 py-3 text-sm">{t("warning")}</p>
          <Decision id={id} />
        </>
      ) : (
        <p className="text-base">{t(state)}</p>
      )}
    </Shell>
  );
}

function Shell({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {message ? <p className="text-base">{message}</p> : children}
    </main>
  );
}
