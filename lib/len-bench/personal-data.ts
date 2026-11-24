// WHAT NEVER LEAVES THE BOX (spec local 2026-11-24-servidor-de-google-calendar, §5.8): the replay scenes and the bench's
// customer cases are production conversations that people read, and Google's Limited Use forbids people reading what a
// person's Google account gave Len. So a conversation where Len called a connector — `mcp__<server>__<tool>`, the
// person's own MCP servers and an installed tool's operations alike — is never fetched. Only a tool's NAME field counts
// (`name`, `tool`, the OpenAI-shaped `function.name`): «mcp__» typed by the owner or said by Len is just text.

const CONNECTOR_PREFIX = "mcp__";
const NAME_FIELDS = ["name", "tool"] as const;
/** Len's tools that read a connector's resources (`RESOURCE_TOOL_NAMES` of lib/mcp-connectors/turn.ts, which pulls the
 *  server's modules this script-side file can't): no mcp__ prefix, the connector's data all the same — as Claude Code
 *  counts its ListMcpResourcesTool and ReadMcpResourceTool. */
const RESOURCE_TOOLS: ReadonlySet<string> = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
const isConnectorTool = (name: string) => name.startsWith(CONNECTOR_PREFIX) || RESOURCE_TOOLS.has(name);

/**
 * The same rule as a Postgres condition on a jsonb `column` (a SQL expression, e.g. `m.transcript`), for the fetchers to
 * ask the box BEFORE bringing anything (§5.8: it never reaches the development machine). On jsonb's text a key is written
 * `"name": "…"`, so only a name FIELD matches; a quote inside a message is escaped and never does.
 */
export function connectorCallsIn(column: string): string {
  const names = [...RESOURCE_TOOLS].map((n) => `${n}"`).join("|");
  return `(${column})::text ~ '"(name|tool)":\\s*"(${CONNECTOR_PREFIX}|${names})'`;
}

/** True if anywhere in `value` an object names a connector's tool in its `name` or `tool` field. */
export function carriesConnectorResults(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const v = pending.pop();
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      pending.push(...v);
      continue;
    }
    const o = v as Record<string, unknown>;
    for (const field of NAME_FIELDS) {
      const named = o[field];
      if (typeof named === "string" && isConnectorTool(named)) return true;
    }
    pending.push(...Object.values(o));
  }
  return false;
}

/** The line a fetcher prints (or throws) for what it left on the box. */
export const LEFT_FOR_LIMITED_USE = "carries a connector's results: not fetched (Google Limited Use)";
