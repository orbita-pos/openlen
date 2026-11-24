// OPENLEN'S GOOGLE CALENDAR MCP SERVER (spec local 2026-11-24-servidor-de-google-calendar). In production it is reached at
// https://mcp.openlen.com/google-calendar (rewrites of next.config, lib/mcp/host-rewrite.ts); locally at
// /api/mcp/google-calendar. Google signs the person in; this route takes their Google token and keeps nothing.
import { buildGcalMcpHandler } from "@/lib/google-calendar-mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = buildGcalMcpHandler({
  clientId: process.env.OPENLEN_MCP_GOOGLE_CLIENT_ID?.trim() ?? "",
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
});

export { handler as DELETE, handler as GET, handler as POST };
