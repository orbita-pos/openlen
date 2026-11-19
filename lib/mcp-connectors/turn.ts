// WHAT ONE TURN GETS OF THE SPEAKER'S CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.4, §5.5). A turn never waits
// on a server: it declares the lists stored by the last mount (mount.ts), sorted, so the same lists give the same bytes,
// and it opens a connection only on its first call to a server, closing everything when the turn ends. With servers, it
// also gets DeepSeek's three shared resource tools and a reminder in the turn's context (never the shared conversation:
// these are the person's) with DeepSeek's resource sentence, each server's instructions and a line for each server that
// isn't connected.
import type { ToolOutcome } from "@/lib/agent/tools";

import { hostOf, issuerHostOf, type McpApprovalCard } from "./approval";
import type { McpConnection, openMcp } from "./client";
import { entryFingerprint, parseMcpConfig, type McpServerEntry } from "./config";
import { directoryFor, type DirectoryEntry } from "./directory";
import { MOUNT_MAX_ATTEMPTS, serversToMount } from "./mount";
import { asNeedsSignIn, connectionProvider, NeedsSignIn, type ConnectionProvider, type OAuthDeps, type SignInReason } from "./oauth/provider";
import { projectCallResult, renderResource } from "./project";
import type { ServerState, StoredConfig } from "./store";
import { credentialRefsOf, makeRedactor, resolveEntry } from "./templates";

export const AUTHENTICATE_TOOL = "authenticate";
export const SUGGEST_CONNECTORS_TOOL = "suggest_connectors";
export const RESOURCE_TOOL_NAMES = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"] as const;
export const CONNECTOR_TOOLS_MAX = 128;
export const CONNECTOR_DECLARATIONS_MAX_BYTES = 256 * 1024;
export const INSTRUCTIONS_TOTAL_MAX_BYTES = 64 * 1024;

export function suggestConnectorsDeclaration(entries: readonly DirectoryEntry[]): Record<string, unknown> {
  const list = entries.map((e) => `${e.id} — ${e.what}`).join("; ");
  return {
    name: SUGGEST_CONNECTORS_TOOL,
    description: `Suggest connecting one of these services when the person's request needs something you can't do with your tools: ${list}. The person sees a Connect card; nothing connects until they tap it.`,
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { enum: entries.map((e) => e.id) },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["ids"],
    },
  };
}

export function authenticateDescription(
  server: string,
  host: string,
  issuerHost: string,
  reason: SignInReason,
  scope: string | null = null,
): string {
  if (reason === "lapsed") {
    return `The "${server}" connector is installed, but its sign-in has stopped working, so its tools are unavailable. Call this tool only when the user's request needs this connector (even if they didn't name it explicitly). It tries the connection again. If the connector still needs a sign-in, the call fails, and the person is shown a "Connect" button to sign in again. Then tell them in one short sentence that ${server} needs them to sign in again, carry on with whatever does not need it, and do not call this tool again until they send another message. Do not ask the user for authorization codes, tokens, or URLs.`;
  }
  const why = reason === "scope" ? `needs additional permissions (scope: "${scope ?? ""}")` : "requires authentication";
  return `The "${server}" MCP server (streamable-http at ${host}) is installed but ${why}. Call this tool when the user's request needs it: the person is shown a "Connect" button to sign in at ${issuerHost}. Once they finish in their browser, the server's real tools become available on their next message. Do not ask the user for authorization codes, tokens, or URLs.`;
}

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
  personEmail?(personId: string): Promise<string | null>;
  env?: Readonly<Record<string, string | undefined>>;
  now(): Date;
}

export interface TurnConnectors {
  readonly declarations: Record<string, unknown>[];
  readonly routes: ReadonlyMap<string, { readonly server: string; readonly rawName: string }>;
  /** Every server name in ~/.len/mcp.json: taken in the namespace an installed tool's operations share. */
  readonly serverNames: readonly string[];
  /** Servers whose tools are declared or whose resources can be read this turn, with their entries. */
  readonly active: ReadonlyMap<string, McpServerEntry>;
  /** Approved servers in `needs-auth`: each declares only `mcp__<server>__authenticate`. */
  readonly needsAuth?: ReadonlyMap<string, ServerState>;
  /** Curated directory entries available to this person (`suggest_connectors`). */
  readonly directory?: readonly DirectoryEntry[];
  /** The active servers that advertise resources: the only ones the resource tools take. */
  readonly resourceServers: readonly string[];
  readonly contextText: string;
  /** Approved servers to mount outside this turn (never listed, changed, stale or old). */
  readonly toMount: readonly string[];
}

const EMPTY: TurnConnectors = { declarations: [], routes: new Map(), serverNames: [], active: new Map(), resourceServers: [], contextText: "", toMount: [] };
const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

export async function connectorsForTurn(personId: string, d: TurnDeps): Promise<TurnConnectors> {
  const stored = await d.readConfig(personId);
  const parsed = parseMcpConfig(stored.text, { reservedServerNames: new Set() });
  if (!parsed.ok) return EMPTY;
  const config = parsed.config;
  const names = Object.keys(config.servers).sort();
  const email = d.personEmail ? await d.personEmail(personId).catch(() => null) : null;
  const directory = directoryFor(email, config, d.env);
  if (names.length === 0 && directory.length === 0) return EMPTY;
  if (names.length === 0) {
    return {
      declarations: [suggestConnectorsDeclaration(directory)],
      routes: new Map([[SUGGEST_CONNECTORS_TOOL, { server: "", rawName: SUGGEST_CONNECTORS_TOOL }]]),
      serverNames: [],
      active: new Map(),
      directory,
      resourceServers: [],
      contextText: "",
      toMount: [],
    };
  }
  const states = await d.readStates(personId);
  const stateOf = new Map(states.map((s) => [s.serverName, s]));
  const lines: string[] = [];
  const ready: { name: string; entry: McpServerEntry; state: ServerState }[] = [];
  const needsAuth: { name: string; entry: McpServerEntry; state: ServerState }[] = [];
  for (const name of names) {
    const entry = config.servers[name]!;
    if (!entry.enabled) continue;
    const fp = entryFingerprint(entry);
    const state = stateOf.get(name);
    if (stored.approved[name] !== fp) lines.push(`- ${name}: pending approval (the person approves it in a card or on the Herramientas page)`);
    else if (state?.status === "needs-auth" && state.fingerprint === fp) {
      const reason = state.authReason ?? "first";
      const why =
        reason === "lapsed"
          ? "needs sign-in again"
          : reason === "scope"
            ? `needs additional permissions (scope: "${state.authScope ?? ""}")`
            : "needs sign-in";
      lines.push(`- ${name}: ${why} (call mcp__${name}__${AUTHENTICATE_TOOL})`);
      needsAuth.push({ name, entry, state });
    } else if (state?.status === "waiting-credentials" && (!state.listedAt || state.fingerprint !== fp))
      lines.push(`- ${name}: waiting-credentials: ${credentialRefsOf(entry).join(", ")}`);
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
  for (const { name, entry, state } of needsAuth) {
    const publicName = `mcp__${name}__${AUTHENTICATE_TOOL}`;
    const reason = state.authReason ?? "first";
    const decl = {
      name: publicName,
      description: authenticateDescription(name, hostOf(entry.url), issuerHostOf(entry, state.authIssuer), reason, state.authScope),
      parameters: { type: "object", properties: {} },
    };
    const size = bytesOf(JSON.stringify(decl));
    if (routes.has(publicName) || declarations.length >= CONNECTOR_TOOLS_MAX || bytes + size > CONNECTOR_DECLARATIONS_MAX_BYTES) continue;
    bytes += size;
    routes.set(publicName, { server: name, rawName: AUTHENTICATE_TOOL });
    declarations.push(decl);
  }
  declarations.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Only servers that advertise resources are named for the resource tools (Jesús, 06/11; DeepSeek names them all).
  const resourceNames = ready.filter((r) => r.state.hasResources).map((r) => r.name).sort();
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
    ...(resourceNames.length > 0 ? [`Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: ${JSON.stringify(resourceNames)}.`] : []),
    ...sections,
    ...(lines.length > 0 ? ["MCP servers in ~/.len/mcp.json that you can't use yet:", ...lines] : []),
  ];
  if (directory.length > 0) {
    routes.set(SUGGEST_CONNECTORS_TOOL, { server: "", rawName: SUGGEST_CONNECTORS_TOOL });
  }
  const withResources = resourceNames.length > 0 ? [...declarations, ...RESOURCE_TOOL_DECLARATIONS] : declarations;
  return {
    declarations: directory.length > 0 ? [...withResources, suggestConnectorsDeclaration(directory)] : withResources,
    resourceServers: resourceNames,
    routes,
    serverNames: names,
    active: new Map([...ready, ...needsAuth].map((r) => [r.name, r.entry])),
    ...(needsAuth.length > 0 && { needsAuth: new Map(needsAuth.map((r) => [r.name, r.state])) }),
    ...(directory.length > 0 && { directory }),
    contextText: text.length > 0 ? `<system-reminder>\nThe person's MCP servers (their ~/.len/mcp.json):\n${text.join("\n\n")}\n</system-reminder>\n` : "",
    toMount: serversToMount(states, config, stored.approved, d.now()),
  };
}

export interface CallDeps {
  resolveCredentials(personId: string, names: readonly string[]): Promise<Map<string, string>>;
  open: typeof openMcp;
  fetch: typeof fetch;
  markStale(personId: string, serverName: string): Promise<void>;
  mount?(personId: string, serverName: string): Promise<ServerState | null>;
  markNeedsAuth?(personId: string, serverName: string, reason: SignInReason, issuer: string | null, scope: string | null): Promise<void>;
  oauth?: OAuthDeps;
  modelTakesImages: boolean;
}

const failure = (text: string): ToolOutcome => ({ response: { isError: true, content: [{ type: "text", text }] } });
const MAY_HAVE_RUN = "It may have completed: check before calling it again.";
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const hasOwnAuthorization = (entry: McpServerEntry): boolean => Object.keys(entry.headers).some((h) => h.toLowerCase() === "authorization");

type Opened = { conn: McpConnection; redact: (s: string) => string; provider?: ConnectionProvider };

export class TurnConnections {
  private readonly opened = new Map<string, Promise<Opened | string>>();
  private readonly authTried = new Set<string>();

  constructor(
    private readonly personId: string,
    private readonly turn: TurnConnectors,
    private readonly d: CallDeps,
    private readonly opts: { readonly attended: boolean } = { attended: true },
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
        const provider = this.d.oauth && !hasOwnAuthorization(entry) ? connectionProvider(this.personId, server, entry, this.d.oauth) : undefined;
        try {
          return {
            conn: await this.d.open(
              { url: resolved.url, headers: resolved.headers },
              { fetch: this.d.fetch, timeoutMs: entry.startupTimeoutMs, signal, ...(provider && { authProvider: provider }) },
            ),
            redact,
            provider,
          };
        } catch (err) {
          const needs = err instanceof NeedsSignIn ? err : await asNeedsSignIn(provider, err);
          if (needs) {
            await this.d.markNeedsAuth?.(this.personId, server, needs.reason, needs.issuer, needs.scope).catch(() => {});
            return authenticateDescription(server, hostOf(entry.url), issuerHostOf(entry, needs.issuer), "lapsed");
          }
          return `${server}: couldn't connect: ${redact(messageOf(err))}`;
        }
      })();
      this.opened.set(server, p);
    }
    return p;
  }

  private async authenticate(server: string, initialState: ServerState): Promise<ToolOutcome> {
    if (this.authTried.has(server)) return failure(`The "${server}" connector was already tried in this turn.`);
    this.authTried.add(server);
    const mounted = this.d.mount ? await this.d.mount(this.personId, server).catch(() => null) : null;
    if (mounted?.status === "connected") {
      return { response: { content: [{ type: "text", text: `The "${server}" connector is connected again. Its tools are available from the person's next message.` }] } };
    }
    if (!this.opts.attended) {
      return {
        response: {
          content: [
            {
              type: "text",
              text: `Nobody can sign in right now (this turn runs without the person). Tell them in one short sentence that ${server} needs them to connect it in OpenLen, and carry on with whatever does not need ${server}.`,
            },
          ],
        },
      };
    }
    const state = mounted?.status === "needs-auth" ? mounted : initialState;
    const entry = this.turn.active.get(server)!;
    const reason = state.authReason ?? "first";
    const mcpApproval: McpApprovalCard = {
      server,
      host: hostOf(entry.url),
      headerNames: Object.keys(entry.headers).sort(),
      credentials: [],
      fingerprint: entryFingerprint(entry),
      version: 0,
      oauth: { issuerHost: issuerHostOf(entry, state.authIssuer), reason },
    };
    return {
      response: {
        content: [
          {
            type: "text",
            text: `The person is shown a "Connect" button for ${server}. Tell them in one short sentence, and carry on with whatever does not need ${server}.`,
          },
        ],
      },
      mcpApproval,
    };
  }

  private suggest(args: Record<string, unknown>): ToolOutcome {
    const rawIds = Array.isArray(args.ids) ? args.ids.filter((x): x is string => typeof x === "string") : [];
    const byId = new Map((this.turn.directory ?? []).map((e) => [e.id, e]));
    const picked = rawIds.map((id) => byId.get(id)).filter((e): e is DirectoryEntry => e !== undefined);
    if (picked.length === 0) return failure("suggest_connectors needs at least one available connector id.");
    const names = picked.map((e) => e.name).join(", ");
    if (!this.opts.attended) {
      return {
        response: {
          content: [
            {
              type: "text",
              text: `Nobody can sign in right now (this turn runs without the person). Tell them in one short sentence that ${names} needs them to connect it in OpenLen, and carry on with whatever does not need ${names}.`,
            },
          ],
        },
      };
    }
    const first = picked[0]!;
    const host = hostOf(first.entry.url);
    const mcpApproval: McpApprovalCard = {
      server: first.server,
      host,
      headerNames: [],
      credentials: [],
      fingerprint: "",
      version: 0,
      oauth: { issuerHost: hostOf(first.issuer), reason: "first" },
      suggest: { id: first.id, name: first.name, host },
    };
    return {
      response: {
        content: [
          {
            type: "text",
            text: `The person is shown a Connect card for ${names}. Tell them in one short sentence what it lets you do once connected.`,
          },
        ],
      },
      mcpApproval,
    };
  }

  async call(publicName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    if (publicName === SUGGEST_CONNECTORS_TOOL && this.turn.directory?.length) return this.suggest(args);
    const route = this.turn.routes.get(publicName);
    if (!route) return failure(`${publicName} isn't one of your MCP servers' tools in this turn.`);
    const authState = route.rawName === AUTHENTICATE_TOOL ? this.turn.needsAuth?.get(route.server) : undefined;
    if (authState) return this.authenticate(route.server, authState);
    const opened = await this.open(route.server, signal);
    if (typeof opened === "string") return failure(opened);
    const entry = this.turn.active.get(route.server)!;
    try {
      const result = await opened.conn.callTool(route.rawName, args, { timeoutMs: entry.toolCallTimeoutMs, signal });
      const { response, images } = projectCallResult(result, opened.redact, this.d.modelTakesImages);
      return images ? { response, images } : { response };
    } catch (err) {
      const needs = err instanceof NeedsSignIn ? err : await asNeedsSignIn(opened.provider, err);
      if (needs) {
        const text = authenticateDescription(route.server, hostOf(entry.url), issuerHostOf(entry, needs.issuer), "lapsed");
        this.opened.set(route.server, Promise.resolve(text));
        await this.d.markNeedsAuth?.(this.personId, route.server, needs.reason, needs.issuer, needs.scope).catch(() => {});
        return failure(text);
      }
      const message = opened.redact(messageOf(err));
      // A tool the server no longer has: re-list it outside the next turn (DeepSeek re-syncs on a changed list).
      if (/not found|unknown tool/i.test(message)) await this.d.markStale(this.personId, route.server).catch(() => {});
      const mayHaveRun = /took longer than|timed? ?out|abort|stopped/i.test(message);
      return failure(`${route.server}: ${message}${mayHaveRun ? ` ${MAY_HAVE_RUN}` : ""}`);
    }
  }

  async resource(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const server = typeof args.server === "string" ? args.server : "";
    if (!this.turn.resourceServers.includes(server)) return failure(`${server || "(no server)"} isn't one of your MCP servers with resources: ${JSON.stringify(this.turn.resourceServers)}`);
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
      const entry = this.turn.active.get(server)!;
      const needs = err instanceof NeedsSignIn ? err : await asNeedsSignIn(opened.provider, err);
      if (needs) {
        const text = authenticateDescription(server, hostOf(entry.url), issuerHostOf(entry, needs.issuer), "lapsed");
        this.opened.set(server, Promise.resolve(text));
        await this.d.markNeedsAuth?.(this.personId, server, needs.reason, needs.issuer, needs.scope).catch(() => {});
        return failure(text);
      }
      return failure(`${server}: ${opened.redact(messageOf(err))}`);
    }
  }

  async closeAll(): Promise<void> {
    const all = await Promise.all(this.opened.values());
    this.opened.clear();
    await Promise.all(all.map((o) => (typeof o === "string" ? undefined : o.conn.close())));
  }
}
