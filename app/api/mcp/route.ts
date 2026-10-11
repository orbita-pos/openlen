// EL ENDPOINT MCP. En producción se llega por https://mcp.openlen.com/mcp
// (rewrites de next.config, lib/mcp/host-rewrite.ts).
import { verifyMcpToken } from "@/lib/mcp/auth";
import { buildMcpHandler } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = buildMcpHandler(verifyMcpToken);

export { handler as DELETE, handler as GET, handler as POST };
