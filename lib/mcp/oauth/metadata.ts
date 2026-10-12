// LA METADATA DEL SERVIDOR DE AUTORIZACIÓN (RFC 8414). Los cinco detalles del
// informe: CIMD y DCR a la vez (Claude sólo usa CIMD si se anuncian
// `client_id_metadata_document_supported` y `none`), `iss` anunciado (Gemini
// CLI es estricto), todo en el origen del issuer (Codex), PKCE S256, refresh.
// `offline_access` va AQUÍ y no en el PRM: la spec lo prohíbe allí, y Claude y
// ChatGPT lo esperan para pedir refresh tokens.
import { MCP_SCOPES, mcpIssuer, siteOrigin } from "../config";

type Env = Readonly<Record<string, string | undefined>>;

export function oauthEndpoints(env: Env = process.env) {
  const issuer = mcpIssuer(env).replace(/\/$/, "");
  return {
    authorize: `${issuer}/api/oauth/authorize`,
    token: `${issuer}/api/oauth/token`,
    register: `${issuer}/api/oauth/register`,
    revoke: `${issuer}/api/oauth/revoke`,
  };
}

export function authorizationServerMetadata(env: Env = process.env): Record<string, unknown> {
  const e = oauthEndpoints(env);
  return {
    issuer: mcpIssuer(env).replace(/\/$/, ""),
    authorization_endpoint: e.authorize,
    token_endpoint: e.token,
    registration_endpoint: e.register,
    revocation_endpoint: e.revoke,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES, "offline_access"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${siteOrigin(env)}/mcp`,
  };
}
