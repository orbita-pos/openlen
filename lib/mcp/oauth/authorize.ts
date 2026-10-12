// /AUTHORIZE: valida, guarda la petición y manda a la pantalla de
// consentimiento. Lo que no se puede atribuir a un cliente y una redirección
// registrados se enseña en la página; lo demás vuelve al cliente con `error`,
// su `state` y `iss` (RFC 9207: sin él Gemini CLI no sigue).
import crypto from "node:crypto";
import { db, schema } from "@/lib/db";
import { MCP_SCOPES, mcpIssuer, mcpResourceUrl } from "../config";
import { normalizeScopes } from "../tokens";
import { resolveClient as realResolveClient, type OauthClient } from "./clients";
import { redirectUriMatches } from "./redirects";

/** Lo que piden algunos clientes que no es un permiso del MCP. */
const NOT_MCP_SCOPES = new Set(["offline_access", "openid"]);

export const AUTH_REQUEST_TTL_MS = 10 * 60_000;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

type Env = Readonly<Record<string, string | undefined>>;

export function withIss(redirectUri: string, params: Record<string, string | undefined>, env: Env = process.env): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("iss", mcpIssuer(env).replace(/\/$/, ""));
  return u.toString();
}

export async function startAuthorization(
  params: URLSearchParams,
  deps: { resolveClient: (id: string) => Promise<OauthClient | null> } = { resolveClient: (id) => realResolveClient(id) },
): Promise<
  | { kind: "consent"; requestId: string }
  | { kind: "redirect"; url: string }
  | { kind: "error"; status: number; error: string; description: string }
> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const client = clientId ? await deps.resolveClient(clientId) : null;
  if (!client) return { kind: "error", status: 400, error: "invalid_client", description: "Unknown client_id." };
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: "error", status: 400, error: "invalid_request", description: "redirect_uri is not registered for this client." };
  }
  const state = params.get("state") ?? undefined;
  const back = (error: string, description: string) => ({
    kind: "redirect" as const,
    url: withIss(redirectUri, { error, error_description: description, state }),
  });
  if (params.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !S256_CHALLENGE.test(challenge)) {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  const resource = params.get("resource");
  if (resource && resource.replace(/\/$/, "") !== mcpResourceUrl().replace(/\/$/, "")) {
    return back("invalid_target", "This authorization server only issues tokens for the OpenLen MCP server.");
  }
  const asked = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const known = normalizeScopes(asked);
  // Nada, u offline_access/openid a solas, es no haber pedido ningún permiso
  // del MCP: los tres, y la persona los recorta en la pantalla.
  const scopes = known.length === 0 && asked.every((s) => NOT_MCP_SCOPES.has(s)) ? [...MCP_SCOPES] : known;
  if (scopes.length === 0) return back("invalid_scope", "None of the requested scopes exist here.");
  const requestId = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.mcpOauthRequests).values({
    id: requestId,
    clientId: client.id,
    redirectUri,
    state: state ?? null,
    codeChallenge: challenge,
    scopes,
    resource: resource ?? null,
    expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
  });
  return { kind: "consent", requestId };
}
