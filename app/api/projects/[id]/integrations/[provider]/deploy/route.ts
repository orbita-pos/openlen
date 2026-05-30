import { auth } from "@/auth";
import { isProvider } from "@/lib/integrations/oauth";
import { decryptToken } from "@/lib/integrations/crypto";
import {
  getConnection,
  getExportHtml,
  ProviderError,
  recordDeployment,
  runDeploy,
} from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/projects/[id]/integrations/[provider]/deploy  body: { name }
// Push the project's optimized static HTML to the connected provider account.
//
// Status map (UI matches on these):
//   400 invalid_name   — name fails the slug regex
//   400 not_connected  — no stored connection (user must connect first)
//   401 token_invalid  — provider rejected the token (reconnect needed)
//   404 not_found      — project doesn't exist for this user
//   502 provider_error — provider API failed (message forwarded)
//   500 deploy_failed  — unexpected error

// Lowercase, hyphen-separated, no leading/trailing hyphen, 1–39 chars. Safe for
// both a GitHub repo name and a Vercel project name.
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; provider: string }> },
): Promise<Response> {
  const { id, provider } = await params;
  if (!isProvider(provider)) return json({ error: "unknown_provider" }, 404);
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = (body?.name ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name)) return json({ error: "invalid_name" }, 400);

  const exportHtml = await getExportHtml(id, session.user.id);
  if (!exportHtml) return json({ error: "not_found" }, 404);

  const conn = await getConnection(session.user.id, provider);
  if (!conn) return json({ error: "not_connected" }, 400);

  let accessToken: string;
  try {
    accessToken = decryptToken(conn.accessToken);
  } catch {
    // Corrupt/unreadable ciphertext — treat as a broken connection.
    return json({ error: "not_connected" }, 400);
  }

  try {
    const result = await runDeploy({
      provider,
      accessToken,
      teamId: conn.teamId,
      name,
      html: exportHtml.html,
    });
    await recordDeployment({
      projectId: id,
      provider,
      remoteName: result.remoteName,
      liveUrl: result.liveUrl,
      sha: exportHtml.sha,
    });
    return json({ ok: true, liveUrl: result.liveUrl, remoteName: result.remoteName }, 200);
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.status === 401) {
        return json({ error: "token_invalid", message: err.message }, 401);
      }
      return json({ error: "provider_error", message: err.message }, 502);
    }
    // eslint-disable-next-line no-console
    console.error("[deploy] unexpected error:", err);
    return json({ error: "deploy_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
