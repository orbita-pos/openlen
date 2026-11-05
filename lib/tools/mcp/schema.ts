// WHAT LEN MAY BE GIVEN OF A TOOL'S OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7). An installed
// tool's operations go into the tool list of every turn of its person, in every project: one the provider rejects would
// break all of them. So, at install, each operation from the server's `tools/list` is checked — a name the provider takes
// once prefixed (`mcp__<serverName>__<name>`, `^[a-zA-Z0-9_-]{1,64}$`), a JSON Schema whose root is an object, without
// `$ref` (the provider wants it inline) and of a sane size — and what fails is left out with a problem naming it. Pure.

import type { McpTool } from "./client";

/** An operation as stored with the installed version, ready to be declared to Len. */
export interface StoredOperation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export const MCP_MAX_TOOLS = 32;
export const MCP_SCHEMA_MAX_BYTES = 16_384;
export const MCP_DESCRIPTION_MAX = 2_048;
const TOOL_NAME = /^[a-zA-Z0-9_-]+$/;
const PROVIDER_NAME_MAX = 64;

/** The name Len sees: Claude Code's and DeepSeek's. */
export function operationToolName(serverName: string, name: string): string {
  return `mcp__${serverName}__${name}`;
}

function hasRef(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasRef);
  if (!v || typeof v !== "object") return false;
  return Object.entries(v as Record<string, unknown>).some(([k, x]) => k === "$ref" || hasRef(x));
}

/** The first structural problem of a JSON Schema node the provider would choke on, or null: `type` a name or a list of
 *  names, `properties` an object of schemas, `required` a list of names, `items` a schema — all the way down. */
function structureProblem(node: unknown, depth = 0): string | null {
  if (depth > 32) return "is nested too deep";
  if (!node || typeof node !== "object" || Array.isArray(node)) return "has a part that isn't a schema object";
  const n = node as Record<string, unknown>;
  if (n.type !== undefined && typeof n.type !== "string" && !(Array.isArray(n.type) && n.type.every((t) => typeof t === "string"))) return "has a type that isn't a name";
  if (n.properties !== undefined) {
    if (!n.properties || typeof n.properties !== "object" || Array.isArray(n.properties)) return "has properties that aren't an object";
    for (const child of Object.values(n.properties as Record<string, unknown>)) {
      const p = structureProblem(child, depth + 1);
      if (p) return p;
    }
  }
  if (n.required !== undefined && !(Array.isArray(n.required) && n.required.every((r) => typeof r === "string"))) return "has required that isn't a list of names";
  if (n.items !== undefined) {
    const p = structureProblem(n.items, depth + 1);
    if (p) return p;
  }
  return null;
}

export function checkTools(serverName: string, tools: readonly McpTool[]): { tools: StoredOperation[]; problems: string[] } {
  const ok: StoredOperation[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (ok.length >= MCP_MAX_TOOLS) {
      problems.push(`more than ${MCP_MAX_TOOLS} operations: the rest are left out`);
      break;
    }
    const full = operationToolName(serverName, tool.name);
    if (!TOOL_NAME.test(tool.name) || full.length > PROVIDER_NAME_MAX) {
      problems.push(`${tool.name}: its name must be letters, digits, _ or -, and ${full.length > PROVIDER_NAME_MAX ? `"${full}" is over ${PROVIDER_NAME_MAX} characters` : "it isn't"}`);
      continue;
    }
    if (seen.has(tool.name)) {
      problems.push(`${tool.name}: declared twice, the first one stays`);
      continue;
    }
    const { $schema: _dropped, ...schema } = tool.inputSchema;
    if (schema.type !== "object") {
      problems.push(`${tool.name}: its inputSchema must be an object (type: "object")`);
      continue;
    }
    const broken = structureProblem(schema);
    if (broken) {
      problems.push(`${tool.name}: its inputSchema ${broken}`);
      continue;
    }
    if (hasRef(schema)) {
      problems.push(`${tool.name}: its inputSchema uses $ref; write it inline`);
      continue;
    }
    if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > MCP_SCHEMA_MAX_BYTES) {
      problems.push(`${tool.name}: its inputSchema is over ${MCP_SCHEMA_MAX_BYTES} bytes`);
      continue;
    }
    const description = [tool.title, tool.description].filter((s): s is string => typeof s === "string" && s.trim() !== "").join(" — ") || tool.name;
    seen.add(tool.name);
    ok.push({ name: tool.name, description: description.slice(0, MCP_DESCRIPTION_MAX), inputSchema: schema });
  }
  return { tools: ok, problems };
}
