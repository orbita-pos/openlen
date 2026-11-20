// THE SWITCH OF OAUTH FOR CONNECTORS (spec local 2026-11-17-oauth-de-conectores-mcp, §5.9): only the literal "0" turns it
// off, and `OPENLEN_MCP=0` turns off everything, this included. Off, a server that answers 401 is `failed`, as before.
import { connectorsEnabled } from "../enabled";

export function oauthEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return connectorsEnabled(env) && env.OPENLEN_MCP_OAUTH !== "0";
}
