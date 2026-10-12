// EN mcp.<dominio> RESPONDE EL SERVIDOR MCP. Son `rewrites` de next.config y
// NO del middleware: con `NextResponse.rewrite` la caja da 500 (lo mismo que
// el lienzo, lib/lienzo/site-rewrite.ts, medido el 06/10/2026).
//
// Sin imports: lo carga next.config.ts.

// Next lo compara anclado y contra el host sin puerto, en minúsculas.
const ON_MCP_HOST = [{ type: "host" as const, value: "mcp\\..*" }];

export const MCP_REWRITES = [
  { source: "/mcp", has: ON_MCP_HOST, destination: "/api/mcp" },
  { source: "/.well-known/oauth-protected-resource", has: ON_MCP_HOST, destination: "/api/mcp/resource-metadata" },
  { source: "/.well-known/oauth-protected-resource/mcp", has: ON_MCP_HOST, destination: "/api/mcp/resource-metadata" },
];

/** Las rutas bien conocidas del servidor de autorización (en el issuer) y, en
 *  local, la metadata del recurso con la ruta insertada de /api/mcp (en
 *  producción la sirve el host mcp.* con MCP_REWRITES). */
export const OAUTH_REWRITES = [
  { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
  { source: "/.well-known/oauth-protected-resource/api/mcp", destination: "/api/mcp/resource-metadata" },
];

/** Para el middleware: en este host no hay idioma ni login que poner. */
export function isMcpHost(host: string | null): boolean {
  if (!host) return false;
  return /^mcp\.[^:]+(:\d+)?$/i.test(host.trim());
}

/** En el host del MCP sólo vive el MCP. El middleware ve lo que no es /api ni
 *  lleva punto (su matcher): de eso, sólo `/mcp`; la app —portada, login,
 *  workspace— no se sirve en este origen (404). Caddy hace lo mismo delante. */
export function mcpHostAllows(pathname: string): boolean {
  return pathname === "/mcp";
}
