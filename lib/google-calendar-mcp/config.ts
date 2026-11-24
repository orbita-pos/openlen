// OPENLEN'S OWN GOOGLE CALENDAR MCP SERVER — its configuration (spec local 2026-11-24-servidor-de-google-calendar, §5.1,
// §5.4, §5.7). Like Anthropic's gcal.mcp.claude.com: OpenLen hosts it, Google signs the person in. Dependency-free on
// purpose: the connector directory (lib/mcp-connectors/directory-entries.ts) reads these values.
import { connectorsEnabled } from "../mcp-connectors/enabled";

type Env = Readonly<Record<string, string | undefined>>;

/** The smallest Google scopes that cover the nine tools (the ones Google lists for its own Calendar server, without the
 *  read-only one `calendar.events` already includes). */
export const GCAL_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

const PUBLIC_URL = "https://mcp.openlen.com/google-calendar";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** This machine, over http or https: where `next dev` serves the server. */
function isLoopback(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname);
}

/**
 * The server's public URL (RFC 9728 `resource`). Locally: http://localhost:3000/api/mcp/google-calendar.
 *
 * This URL decides which server gets OpenLen's own Google client (the directory's entry), so `GCAL_MCP_RESOURCE_URL`
 * takes only approved endpoints, as Claude Code takes `CLAUDE_CODE_CUSTOM_OAUTH_URL`: the public URL, or this machine
 * outside production. Anything else throws by name instead of quietly pointing the client somewhere else.
 */
export function gcalResourceUrl(env: Env = process.env): string {
  const set = env.GCAL_MCP_RESOURCE_URL?.trim();
  if (!set) return PUBLIC_URL;
  if (set === PUBLIC_URL || (env.NODE_ENV !== "production" && isLoopback(set))) return set;
  throw new Error("GCAL_MCP_RESOURCE_URL is not an approved endpoint.");
}

/** Its Protected Resource Metadata, with the resource's path inserted (RFC 9728 §3.1). */
export function gcalResourceMetadataUrl(env: Env = process.env): string {
  const u = new URL(gcalResourceUrl(env));
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.origin}/.well-known/oauth-protected-resource${path}`;
}

/** On unless `OPENLEN_GCAL_MCP` (or the connectors' own `OPENLEN_MCP`) is the literal "0". */
export function gcalEnabled(env: Env = process.env): boolean {
  return connectorsEnabled(env) && env.OPENLEN_GCAL_MCP !== "0";
}
