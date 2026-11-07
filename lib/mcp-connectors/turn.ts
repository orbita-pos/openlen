// WHAT ONE TURN GETS OF THE SPEAKER'S CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.4, §5.5). A turn never waits
// on a server: it declares the lists stored by the last mount (mount.ts), sorted, so the same lists give the same bytes,
// and it opens a connection only on its first call to a server, closing everything when the turn ends. With servers, it
// also gets DeepSeek's three shared resource tools and a reminder in the turn's context (never the shared conversation:
// these are the person's) with DeepSeek's resource sentence, each server's instructions and a line for each server that
// isn't connected.
import type { ToolOutcome } from "@/lib/agent/tools";

import type { McpConnection, openMcp } from "./client";
import { entryFingerprint, parseMcpConfig, type McpServerEntry } from "./config";
import { MOUNT_MAX_ATTEMPTS, serversToMount } from "./mount";
import { projectCallResult, renderResource } from "./project";
import type { ServerState, StoredConfig } from "./store";
import { credentialRefsOf, makeRedactor, resolveEntry } from "./templates";

export const RESOURCE_TOOL_NAMES = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"] as const;
export const CONNECTOR_TOOLS_MAX = 128;
export const CONNECTOR_DECLARATIONS_MAX_BYTES = 256 * 1024;
export const INSTRUCTIONS_TOTAL_MAX_BYTES = 64 * 1024;

const SERVER_ARG = { type: "string", description: "One of the person's MCP server names, as listed in the turn's context." };
const CURSOR_ARG = { type: "string", description: "The nextCursor of an earlier page, passed unchanged." };

/** DeepSeek's dsh-mcp-resources tools, by name. */
export const RESOURCE_TOOL_DECLARATIONS: readonly Record<string, unknown>[] = [
  {
    name: "list_mcp_resources",
    description: "List the resources (documents, records) one of the person's MCP servers offers.",
    parameters: { type: "object", properties: { server: SERVER_ARG, cursor: CURSOR_ARG }, required: ["server"] },
  },
  {
    name: "list_mcp_resource_templates",
    description: "List the resource URI templates one of the person's MCP servers offers.",
    parameters: { type: "object", properties: { server: SERVER_ARG, cursor: CURSOR_ARG }, required: ["server"] },
  },
  {
    name: "read_mcp_resource",
    description: "Read one resource of one of the person's MCP servers by its URI.",
    parameters: { type: "object", properties: { server: SERVER_ARG, uri: { type: "string", description: "The resource's URI, as listed or expanded from a template." } }, required: ["server", "uri"] },
  },
];

/** The turn's `mcp__` tools in ONE namespace — an installed tool's operations and the connectors', sorted by name —
 *  then DeepSeek's resource tools. A name declared twice is kept once (the operation's, which came first): a list with
 *  duplicates would be refused by the provider, breaking every turn of the person. */
export function mergeMcpDeclarations(operations: readonly Record<string, unknown>[], connectors: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const mcp = [...operations, ...connectors.filter((x) => String(x.name).startsWith("mcp__"))].filter((x) => {
    const name = String(x.name);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  mcp.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return [...mcp, ...connectors.filter((x) => !String(x.name).startsWith("mcp__"))];
}

export interface TurnDeps {
  readConfig(personId: string): Promise<StoredConfig>;
  readStates(personId: string): Promise<ServerState[]>;
  now(): Date;
}

export interface TurnConnectors {
  readonly declarations: Record<string, unknown>[];
  readonly routes: ReadonlyMap<string, { readonly server: string; readonly rawName: string }>;
  /** Every server name in ~/.len/mcp.json: taken in the namespace an installed tool's operations share. */
  readonly serverNames: readonly string[];
  /** Servers whose tools are declared or whose resources can be read this turn, with their entries. */
  readonly active: ReadonlyMap<string, McpServerEntry>;
  readonly contextText: string;
  /** Approved servers to mount outside this turn (never listed, changed, stale or old). */
  readonly toMount: readonly string[];
}

const EMPTY: TurnConnectors = { declarations: [], routes: new Map(), serverNames: [], active: new Map(), contextText: "", toMount: [] };
const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

export async function connectorsForTurn(personId: string, d: TurnDeps): Promise<TurnConnectors> {
  const stored = await d.readConfig(personId);
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  if (!parsed.ok) return EMPTY;
  const config = parsed.config;
  const names = Object.keys(config.servers).sort();
  if (names.length === 0) return EMPTY;
  const states = await d.readStates(personId);
  const stateOf = new Map(states.map((s) => [s.serverName, s]));
  const lines: string[] = [];
  const ready: { name: string; entry: McpServerEntry; state: ServerState }[] = [];
  for (const name of names) {
    const entry = config.servers[name]!;
    if (!entry.enabled) continue;
    const fp = entryFingerprint(entry);
    const state = stateOf.get(name);
    if (stored.approved[name] !== fp) lines.push(`- ${name}: pending approval (the person approves it in a card or on the Herramientas page)`);
    else if (state?.status === "waiting-credentials" && (!state.listedAt || state.fingerprint !== fp)) lines.push(`- ${name}: waiting-credentials: ${credentialRefsOf(entry).join(", ")}`);
    // DeepSeek: after its attempt budget the server's tools are removed until the configuration is reloaded.
    else if (state?.status === "failed" && state.fingerprint === fp && state.failures >= MOUNT_MAX_ATTEMPTS)
      lines.push(`- ${name}: failed ${state.failures} times in a row (${state.error ?? "unknown error"}); it stopped retrying until the person saves or approves it again on the Herramientas page`);
    else if (!state || state.fingerprint !== fp || !state.listedAt) lines.push(state?.status === "failed" && state.fingerprint === fp ? `- ${name}: failed: ${state.error ?? "unknown error"}` : `- ${name}: not listed yet`);
    else {
      ready.push({ name, entry, state });
      if (state.status === "failed") lines.push(`- ${name}: failed: ${state.error ?? "unknown error"} (its last list is still declared)`);
      if (state.status === "waiting-credentials") lines.push(`- ${name}: waiting-credentials: ${credentialRefsOf(entry).join(", ")}`);
    }
  }
  // Oldest first by the time each was first listed, then name: the same servers always fit the same way.
  ready.sort((a, b) => a.state.listedAt!.getTime() - b.state.listedAt!.getTime() || a.name.localeCompare(b.name));
  const routes = new Map<string, { server: string; rawName: string }>();
  const declarations: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const { name, state } of ready) {
    let left = 0;
    for (const t of state.tools) {
      const decl = { name: t.publicName, description: t.description, parameters: t.inputSchema };
      const size = bytesOf(JSON.stringify(decl));
      if (routes.has(t.publicName) || declarations.length >= CONNECTOR_TOOLS_MAX || bytes + size > CONNECTOR_DECLARATIONS_MAX_BYTES) {
        left++;
        continue;
      }
      bytes += size;
      routes.set(t.publicName, { server: name, rawName: t.rawName });
      declarations.push(decl);
    }
    if (left > 0) lines.push(`- ${name}: ${left} tools didn't fit (at most ${CONNECTOR_TOOLS_MAX} across your servers)`);
  }
  declarations.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const activeNames = ready.map((r) => r.name).sort();
  const sections: string[] = [];
  let instructionBytes = 0;
  for (const { name, state } of ready) {
    if (!state.instructions) continue;
    const section = `## MCP server: ${name}\n${state.instructions}`;
    if (instructionBytes + bytesOf(section) > INSTRUCTIONS_TOTAL_MAX_BYTES) {
      lines.push(`- ${name}: its instructions didn't fit`);
      continue;
    }
    instructionBytes += bytesOf(section);
    sections.push(section);
  }
  const text = [
    ...(activeNames.length > 0 ? [`Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: ${JSON.stringify(activeNames)}.`] : []),
    ...sections,
    ...(lines.length > 0 ? ["MCP servers in ~/.len/mcp.json that you can't use yet:", ...lines] : []),
  ];
  return {
    declarations: activeNames.length > 0 ? [...declarations, ...RESOURCE_TOOL_DECLARATIONS] : declarations,
    routes,
    serverNames: names,
    active: new Map(ready.map((r) => [r.name, r.entry])),
    contextText: text.length > 0 ? `<system-reminder>\nThe person's MCP servers (their ~/.len/mcp.json):\n${text.join("\n\n")}\n</system-reminder>\n` : "",
    toMount: serversToMount(states, config, stored.approved, d.now()),
  };
}

export interface CallDeps {
  resolveCredentials(personId: string, names: readonly string[]): Promise<Map<string, string>>;
  open: typeof openMcp;
  fetch: typeof fetch;
  markStale(personId: string, serverName: string): Promise<void>;
  modelTakesImages: boolean;
}

const failure = (text: string): ToolOutcome => ({ response: { isError: true, content: [{ type: "text", text }] } });
const MAY_HAVE_RUN = "It may have completed: check before calling it again.";
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Opened = { conn: McpConnection; redact: (s: string) => string };

export class TurnConnections {
  private readonly opened = new Map<string, Promise<Opened | string>>();

  constructor(
    private readonly personId: string,
    private readonly turn: TurnConnectors,
    private readonly d: CallDeps,
  ) {}

  get routes(): ReadonlyMap<string, unknown> {
    return this.turn.routes;
  }

  private open(server: string, signal?: AbortSignal): Promise<Opened | string> {
    let p = this.opened.get(server);
    if (!p) {
      p = (async () => {
        const entry = this.turn.active.get(server)!;
        const resolved = resolveEntry(entry, await this.d.resolveCredentials(this.personId, credentialRefsOf(entry)));
        if (!resolved.ok) return `${server}: waiting for ${resolved.missing.join(", ")}, which the person sets in OpenLen`;
        const redact = makeRedactor(resolved.resolved);
        try {
          return { conn: await this.d.open({ url: resolved.url, headers: resolved.headers }, { fetch: this.d.fetch, timeoutMs: entry.startupTimeoutMs, signal }), redact };
        } catch (err) {
          return `${server}: couldn't connect: ${redact(messageOf(err))}`;
        }
      })();
      this.opened.set(server, p);
    }
    return p;
  }

  async call(publicName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const route = this.turn.routes.get(publicName);
    if (!route) return failure(`${publicName} isn't one of your MCP servers' tools in this turn.`);
    const opened = await this.open(route.server, signal);
    if (typeof opened === "string") return failure(opened);
    const entry = this.turn.active.get(route.server)!;
    try {
      const result = await opened.conn.callTool(route.rawName, args, { timeoutMs: entry.toolCallTimeoutMs, signal });
      const { response, images } = projectCallResult(result, opened.redact, this.d.modelTakesImages);
      return images ? { response, images } : { response };
    } catch (err) {
      const message = opened.redact(messageOf(err));
      // A tool the server no longer has: re-list it outside the next turn (DeepSeek re-syncs on a changed list).
      if (/not found|unknown tool/i.test(message)) await this.d.markStale(this.personId, route.server).catch(() => {});
      const mayHaveRun = /took longer than|timed? ?out|abort|stopped/i.test(message);
      return failure(`${route.server}: ${message}${mayHaveRun ? ` ${MAY_HAVE_RUN}` : ""}`);
    }
  }

  async resource(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const server = typeof args.server === "string" ? args.server : "";
    if (!this.turn.active.has(server)) return failure(`${server || "(no server)"} isn't one of your MCP servers: ${JSON.stringify([...this.turn.active.keys()].sort())}`);
    const opened = await this.open(server, signal);
    if (typeof opened === "string") return failure(opened);
    const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
    try {
      const json =
        toolName === "list_mcp_resources"
          ? await opened.conn.listResources(cursor)
          : toolName === "list_mcp_resource_templates"
            ? await opened.conn.listResourceTemplates(cursor)
            : typeof args.uri === "string"
              ? await opened.conn.readResource(args.uri)
              : null;
      if (json === null) return failure("read_mcp_resource needs a uri.");
      return { response: { content: [{ type: "text", text: renderResource(server, json) }] } };
    } catch (err) {
      return failure(`${server}: ${opened.redact(messageOf(err))}`);
    }
  }

  async closeAll(): Promise<void> {
    const all = await Promise.all(this.opened.values());
    this.opened.clear();
    await Promise.all(all.map((o) => (typeof o === "string" ? undefined : o.conn.close())));
  }
}
