import { auth } from "@/auth";
import { isProvider, providerConfigured } from "@/lib/integrations/oauth";
import { deleteConnection, getConnection } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/integrations/[provider] — connection status (never the token).
// DELETE /api/integrations/[provider] — disconnect the user's account.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (!isProvider(provider)) return json({ error: "unknown_provider" }, 404);
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const conn = await getConnection(session.user.id, provider);
  return json(
    {
      configured: providerConfigured(provider),
      connected: !!conn,
      accountLabel: conn?.accountLabel ?? null,
    },
    200,
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (!isProvider(provider)) return json({ error: "unknown_provider" }, 404);
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  await deleteConnection(session.user.id, provider);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
