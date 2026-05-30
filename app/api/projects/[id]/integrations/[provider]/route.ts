import { auth } from "@/auth";
import { isProvider, providerConfigured } from "@/lib/integrations/oauth";
import {
  getConnection,
  getDeployment,
  getExportHtml,
  slugifyName,
} from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/integrations/[provider]
// Per-project deploy status: whether the user is connected, the default/last
// target name, the live URL, and whether the project drifted since last deploy.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; provider: string }> },
): Promise<Response> {
  const { id, provider } = await params;
  if (!isProvider(provider)) return json({ error: "unknown_provider" }, 404);
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  // getExportHtml doubles as the ownership check (returns null for a project
  // the user doesn't own) and gives us the current content sha + title.
  const exportHtml = await getExportHtml(id, session.user.id);
  if (!exportHtml) return json({ error: "not_found" }, 404);

  const [conn, dep] = await Promise.all([
    getConnection(session.user.id, provider),
    getDeployment(id, provider),
  ]);

  return json(
    {
      configured: providerConfigured(provider),
      connected: !!conn,
      accountLabel: conn?.accountLabel ?? null,
      remoteName: dep?.remoteName ?? slugifyName(exportHtml.title),
      liveUrl: dep?.liveUrl ?? null,
      lastDeployedAt: dep?.lastDeployedAt?.toISOString() ?? null,
      hasUnpublishedChanges: dep
        ? dep.lastDeploySha !== exportHtml.sha
        : false,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
