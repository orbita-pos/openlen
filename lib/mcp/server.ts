// EL SERVIDOR MCP DE OPENLEN: un manejador Web (Request → Response) sin estado.
// mcp-handler@2 sirve la spec 2026-07-28 y, desde el mismo endpoint, el
// Streamable HTTP sin estado de los clientes de 2025 (GET/DELETE → 405).
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, mcpResourceMetadataUrl, mcpResourceUrl } from "./config";
import { registerOpenLenTools } from "./tools";

export type VerifyMcpToken = (req: Request, bearer?: string) => Promise<AuthInfo | undefined>;

export function buildMcpHandler(verify: VerifyMcpToken): (req: Request) => Promise<Response> {
  const handler = createMcpHandler((server) => registerOpenLenTools(server), {
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  });
  // El origen de la metadata va FIJO (`resourceUrl`): detrás de Caddy, `req.url`
  // de Next no trae el host público (memoria rewrite-del-middleware-es-proxy-en-la-caja).
  // Sólo el ORIGEN: mcp-handler le pega la ruta del recurso a lo que le pases.
  const metadata = new URL(mcpResourceMetadataUrl());
  return withMcpAuth(handler, verify, {
    required: true,
    resourceUrl: new URL(mcpResourceUrl()).origin,
    resourceMetadataPath: metadata.pathname,
  });
}
