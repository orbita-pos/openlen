// GET /api/oauth/authorize → la pantalla de consentimiento (/oauth/consent/<id>,
// el middleware le pone idioma), o de vuelta al cliente con el error.
import { mcpIssuer } from "@/lib/mcp/config";
import { startAuthorization } from "@/lib/mcp/oauth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const r = await startAuthorization(new URL(req.url).searchParams);
  if (r.kind === "consent") return Response.redirect(new URL(`/oauth/consent/${r.requestId}`, mcpIssuer()).toString(), 302);
  if (r.kind === "redirect") return Response.redirect(r.url, 302);
  return new Response(JSON.stringify({ error: r.error, error_description: r.description }), {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
