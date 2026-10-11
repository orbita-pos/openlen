// LA PROTECTED RESOURCE METADATA (RFC 9728). Propia y no la de mcp-handler:
// así `resource` es EXACTAMENTE la URL pública, se llame desde donde se llame.
// Sin `offline_access` aquí (la spec lo prohíbe en el PRM): va en la metadata
// del servidor de autorización (Parte 3).
import { MCP_SCOPES, mcpIssuer, mcpResourceUrl, siteOrigin } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      resource: mcpResourceUrl(),
      authorization_servers: [mcpIssuer()],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "OpenLen",
      resource_documentation: `${siteOrigin()}/mcp`,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "*" },
  });
}
