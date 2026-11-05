// INSTALLING FINDS THE OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): once, right after the
// tool's functions are deployed to production, OpenLen asks the MCP server the tool names (`openlen.tool.mcp`) for its
// tools — as the installer, through the same functions gateway the screen uses — and keeps the checked list with the
// version. Len's tool list then changes only when something is installed: the cache cost DeepSeek warns about is paid
// once per install, not per turn.
import "server-only";

import type { ToolMcpDeclaration } from "../manifest";
import { McpError, mcpSession, type McpSend } from "./client";
import { checkTools, type StoredOperation } from "./schema";

/** What a version keeps of its MCP server. */
export interface ReleaseMcp {
  readonly serverName: string;
  readonly function: string;
  readonly tools: readonly StoredOperation[];
}

export interface DiscoverDeps {
  /** How to reach the tool's live function as `email`; null when it can't be reached (no production backend). */
  send(toolProjectId: string, email: string, fn: string): Promise<McpSend | null>;
}

export async function discoverOperations(
  o: { readonly toolProjectId: string; readonly email: string; readonly mcp: ToolMcpDeclaration },
  d: DiscoverDeps,
): Promise<{ ok: true; mcp: ReleaseMcp; problems: string[] } | { ok: false; error: string }> {
  const send = await d.send(o.toolProjectId, o.email, o.mcp.function).catch(() => null);
  if (!send) return { ok: false, error: "unreachable" };
  try {
    const listed = await mcpSession(send).listTools();
    const { tools, problems } = checkTools(o.mcp.serverName, listed);
    return { ok: true, mcp: { serverName: o.mcp.serverName, function: o.mcp.function, tools }, problems };
  } catch (err) {
    return { ok: false, error: err instanceof McpError ? err.message : String(err) };
  }
}

/** The tool's LIVE function, called in-process through the functions gateway with the person's session in the tool's
 *  production backend (the bridge's `backend`): row level security applies, as for the screen. */
export async function realOperationSend(toolProjectId: string, email: string, fn: string): Promise<McpSend | null> {
  const [{ realHandlerDeps }, { invokeToolFunctionLive }] = await Promise.all([import("../bridge/handlers"), import("@/lib/functions/serve")]);
  const backend = await (await realHandlerDeps()).backend(toolProjectId, "live", email);
  const token = backend?.session.access_token;
  if (!backend || typeof token !== "string") return null;
  const url = `${backend.url}/functions/v1/${encodeURIComponent(fn)}`;
  return (body, headers) =>
    invokeToolFunctionLive(new Request(url, { method: "POST", body, headers: { ...headers, authorization: `Bearer ${token}`, apikey: backend.key } }));
}
