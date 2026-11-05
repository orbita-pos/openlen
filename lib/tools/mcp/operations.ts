// LEN GETS AND CALLS AN INSTALLED TOOL'S OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7). DeepSeek's
// «one operation, two callers»: the tool's screen and Len call the same function. Each turn, the SPEAKER's installed tools
// whose version kept operations (`toolReleases.mcp`) become `mcp__<serverName>__<operation>` — Claude Code's and DeepSeek's
// name — appended at the end of the turn's tools, sorted, so the same installations give the same bytes and only
// installing changes the cache prefix. A call goes, as that person, to the tool's LIVE function — the one exception to
// «Len never writes production»: only the tool's own database, only through the operations the person installed — and
// Len reads MCP's own `CallToolResult`. Every refusal or failure is an error result, never a throw: the turn goes on.
import "server-only";

import { functionsEnabledIn } from "@/lib/functions/enabled";
import type { Plan } from "@/lib/plan";

import type { ToolOutcome } from "@/lib/agent/tools";

import { McpError, mcpSession, type McpSend } from "./client";
import type { ReleaseMcp } from "./discover";
import { toolsEnabled } from "../enabled";
import { operationToolName } from "./schema";

export interface OperationRoute {
  readonly installationId: string;
  readonly toolProjectId: string;
  readonly releaseSha: string;
  readonly function: string;
  readonly operation: string;
}

interface InstallationLike {
  readonly id: string;
  readonly projectId: string;
  readonly releaseSha: string;
  readonly installedAt: Date;
  readonly enabled: boolean;
  readonly removedAt: Date | null;
  readonly personId: string;
}

export interface OperationsDeps {
  functionsOn(): boolean;
  plan(personId: string): Promise<Plan>;
  installations(personId: string): Promise<readonly InstallationLike[]>;
  installation(id: string): Promise<InstallationLike | null>;
  releaseMcp(sha: string): Promise<ReleaseMcp | null>;
  send(toolProjectId: string, email: string, fn: string): Promise<McpSend | null>;
  /** How long one exchange may take (the client's 30 s by default). */
  readonly timeoutMs?: number;
}

/** Operations exist only with tools on (`OPENLEN_TOOLS=0` turns tools off entirely, §4.15) AND the Edge Functions on. */
export function operationsOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return toolsEnabled(env) && functionsEnabledIn(env);
}

/** What Len reads of one call, at most: a tool's answer is data, not a document. */
export const OPERATION_RESULT_MAX_BYTES = 30_000;
const PROVIDER_NAME_MAX = 64;
/** What one person's turns carry of installed operations at most — every one rides every request (Review Focus 1). */
export const MCP_PERSON_MAX_OPERATIONS = 64;
export const MCP_PERSON_MAX_BYTES = 128 * 1024;
/** What OpenLen reads of an operation's answer before cutting it for Len. */
export const OPERATION_READ_MAX_BYTES = 4 * 1024 * 1024;

const active = (r: InstallationLike) => r.enabled && !r.removedAt;

export async function operationsFor(
  personId: string,
  d: OperationsDeps,
): Promise<{ declarations: Record<string, unknown>[]; routes: Map<string, OperationRoute> }> {
  const routes = new Map<string, OperationRoute>();
  if (!d.functionsOn() || (await d.plan(personId)) === "free") return { declarations: [], routes };
  const rows = [...(await d.installations(personId))].filter(active).sort((a, b) => a.installedAt.getTime() - b.installedAt.getTime() || a.id.localeCompare(b.id));
  const declarations: Record<string, unknown>[] = [];
  const servers = new Map<string, number>();
  // Oldest installs first, until the person's caps: the same installations always keep the same operations.
  let bytes = 2;
  for (const row of rows) {
    const mcp = await d.releaseMcp(row.releaseSha).catch(() => null);
    if (!mcp || mcp.tools.length === 0) continue;
    const taken = servers.get(mcp.serverName) ?? 0;
    servers.set(mcp.serverName, taken + 1);
    const server = taken === 0 ? mcp.serverName : `${mcp.serverName}_${taken + 1}`;
    for (const tool of mcp.tools) {
      const name = operationToolName(server, tool.name);
      if (name.length > PROVIDER_NAME_MAX || routes.has(name)) continue;
      const declaration = { name, description: tool.description, parameters: tool.inputSchema };
      const size = new TextEncoder().encode(JSON.stringify(declaration)).byteLength + 1;
      if (declarations.length >= MCP_PERSON_MAX_OPERATIONS || bytes + size > MCP_PERSON_MAX_BYTES) continue;
      bytes += size;
      routes.set(name, { installationId: row.id, toolProjectId: row.projectId, releaseSha: row.releaseSha, function: mcp.function, operation: tool.name });
      declarations.push(declaration);
    }
  }
  declarations.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { declarations, routes };
}

function failure(reason: string): ToolOutcome {
  return { response: { isError: true, content: [{ type: "text", text: reason }] } };
}

function capped(result: { content: unknown[]; isError?: boolean; structuredContent?: unknown }): Record<string, unknown> {
  const whole = { content: result.content, ...(result.isError ? { isError: true } : {}), ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) };
  const size = new TextEncoder().encode(JSON.stringify(whole)).byteLength;
  if (size <= OPERATION_RESULT_MAX_BYTES) return whole;
  const text = result.content
    .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : JSON.stringify(c)))
    .join("\n");
  const kept = text.slice(0, OPERATION_RESULT_MAX_BYTES);
  const more = Math.max(0, new TextEncoder().encode(text).byteLength - new TextEncoder().encode(kept).byteLength);
  return { content: [{ type: "text", text: `${kept}\n[cut: ${more} more bytes]` }], ...(result.isError ? { isError: true } : {}) };
}

export async function callOperation(
  personId: string,
  email: string,
  route: OperationRoute,
  args: Record<string, unknown>,
  d: OperationsDeps,
): Promise<ToolOutcome> {
  if (!d.functionsOn()) return failure("functions_off: Edge Functions don't run on this server right now.");
  if ((await d.plan(personId).catch(() => "free" as const)) === "free") return failure("plan_required: a tool's operations are for paid plans.");
  const row = await d.installation(route.installationId).catch(() => null);
  if (!row || !active(row) || row.personId !== personId) return failure("tool_removed: this tool is no longer installed or switched on.");
  if (row.releaseSha !== route.releaseSha) return failure("tool_updated: the tool was installed again; its operations are refreshed on the next turn.");
  const send = await d.send(route.toolProjectId, email, route.function).catch(() => null);
  if (!send) return failure("unreachable: the tool's production backend isn't available.");
  try {
    // Read up to a few MB, then cut what Len reads to 30 KB: a big answer is still an answer (Review Focus 2).
    const session = mcpSession(send, { maxBytes: OPERATION_READ_MAX_BYTES, ...(d.timeoutMs ? { timeoutMs: d.timeoutMs } : {}) });
    return { response: capped(await session.callTool(route.operation, args)) };
  } catch (err) {
    // After the call was sent, a timeout or an oversized answer doesn't mean it didn't run: say so, or Len repeats a write.
    const mayHaveRun = err instanceof McpError && (err.code === "timeout" || err.code === "too_large");
    const reason = err instanceof McpError ? `${err.code}: ${err.message}` : String(err);
    return failure(mayHaveRun ? `${reason}. The operation may have completed: check before calling it again.` : reason);
  }
}

export async function realOperationsDeps(): Promise<OperationsDeps> {
  const [{ functionsEnabled }, limits, store, { realOperationSend }] = await Promise.all([
    import("@/lib/functions/engines"),
    import("@/lib/limits"),
    import("../store"),
    import("./discover"),
  ]);
  return {
    functionsOn: () => functionsEnabled() && toolsEnabled(),
    plan: (p) => limits.getUserPlan(p),
    installations: (p) => store.listInstallations(p),
    installation: (id) => store.installationById(id),
    releaseMcp: (sha) => store.readReleaseMcp(sha),
    send: realOperationSend,
  };
}
