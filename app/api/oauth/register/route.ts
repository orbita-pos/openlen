// REGISTRO DINÁMICO DE CLIENTES (RFC 7591). Obsoleto en la spec 2026-07-28 en
// favor de CIMD, pero Gemini CLI, OpenCode, Kimi, Cursor y VS Code sólo hablan
// DCR. Abierto (es el estándar), con tope por IP: Claude y Gemini CLI
// registran un cliente nuevo en cada conexión.
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { registerDcrClient } from "@/lib/mcp/oauth/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

export async function POST(req: Request): Promise<Response> {
  const gate = await checkAndConsume(ipLimitKey(getClientIp(req), "oauth_register"), [{ windowMs: 60 * 60_000, max: 20, label: "hourly" }]).catch(
    () => ({ ok: false }),
  );
  if (!gate.ok) return json({ error: "too_many_requests", error_description: "Too many registrations from this address. Try later." }, 429);
  const body = await req.json().catch(() => null);
  const r = await registerDcrClient(body);
  if (!r.ok) return json({ error: r.error, error_description: r.description }, 400);
  return json(
    {
      client_id: r.client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: r.client.name,
      redirect_uris: r.client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" },
  });
}
