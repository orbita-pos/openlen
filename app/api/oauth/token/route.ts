// POST /api/oauth/token (RFC 6749 + PKCE). Acepta form-urlencoded (lo que
// mandan Claude y los demás) y JSON. Clientes públicos: sin secreto.
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { exchangeCode, refreshTokens } from "@/lib/mcp/oauth/issue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache", "access-control-allow-origin": "*" },
  });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

async function fields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(b).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

export async function POST(req: Request): Promise<Response> {
  const gate = await checkAndConsume(ipLimitKey(getClientIp(req), "oauth_token"), [{ windowMs: 60_000, max: 60, label: "per minute" }]).catch(() => ({
    ok: false,
  }));
  if (!gate.ok) return oauthError("slow_down", "Too many token requests from this address.", 429);
  const f = await fields(req);
  if (f.grant_type === "authorization_code") {
    const r = await exchangeCode({
      code: f.code ?? "",
      clientId: f.client_id ?? "",
      redirectUri: f.redirect_uri ?? "",
      codeVerifier: f.code_verifier ?? "",
      resource: f.resource ?? null,
    });
    return r.ok ? json(r.tokens, 200) : oauthError(r.error, r.error === "invalid_target" ? "Unknown resource." : "The code is invalid, expired or already used.");
  }
  if (f.grant_type === "refresh_token") {
    const r = await refreshTokens({ refreshToken: f.refresh_token ?? "", clientId: f.client_id ?? "" });
    return r.ok ? json(r.tokens, 200) : oauthError("invalid_grant", "The refresh token is invalid, expired or revoked. Sign in again.");
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" },
  });
}
