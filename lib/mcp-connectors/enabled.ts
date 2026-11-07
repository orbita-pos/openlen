// LEN'S MCP CONNECTORS' SWITCH (spec local 2026-11-06-conectores-mcp, §5.9): only the literal "0" turns them off.

export function connectorsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_MCP !== "0";
}
