// POST /api/oauth/revoke (RFC 7009). Siempre 200.
import { revokeByToken } from "@/lib/mcp/oauth/revoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const type = req.headers.get("content-type") ?? "";
  const token = type.includes("application/json")
    ? String(((await req.json().catch(() => ({}))) as { token?: unknown }).token ?? "")
    : (new URLSearchParams(await req.text()).get("token") ?? "");
  await revokeByToken(token).catch(() => undefined);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" },
  });
}
