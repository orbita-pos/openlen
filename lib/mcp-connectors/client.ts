// ONE CONNECTION TO A CONNECTOR (spec local 2026-11-06-conectores-mcp, §5.4): the official SDK, as DeepSeek's
// dsh-mcp-client uses it — the harness doesn't frame JSON-RPC itself. Its fetch is the guarded one (fetch.ts). A server
// that doesn't advertise `resources` answers empty lists without a request (DeepSeek). Every request is bounded.
// With an OAuth provider (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 4) the SDK puts the token and
// refreshes it; a connection that needs the person to sign in rejects with the provider's `NeedsSignIn`, and one whose
// 401 isn't a sign-in at all (§5.1: no Bearer challenge, no metadata, no `oauth` block) connects again without OAuth.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { McpCallResult, McpTool } from "@/lib/tools/mcp/client";

import { asNeedsSignIn, NotASignIn, type ConnectionProvider } from "./oauth/provider";

export interface McpConnection {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly instructions: string;
  readonly capabilities: { readonly tools: boolean; readonly resources: boolean; readonly toolsListChanged: boolean };
  listTools(): Promise<McpTool[]>;
  callTool(rawName: string, args: Record<string, unknown>, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<McpCallResult>;
  listResources(cursor?: string): Promise<unknown>;
  listResourceTemplates(cursor?: string): Promise<unknown>;
  readResource(uri: string): Promise<unknown>;
  close(): Promise<void>;
}

const MAX_PAGES = 16;

/** `work`, cut at `ms` — or at once when the turn's signal aborts (the person stopped the turn). */
async function bounded<T>(work: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
    if (signal) {
      onAbort = () => reject(new Error(`${what} was stopped with the turn`));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  work.catch(() => {});
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** The URL a fetch was asked for, whatever form it came in, as `URL` writes it; null if it isn't one. */
function hrefOf(input: RequestInfo | URL): string | null {
  try {
    return new URL(input instanceof Request ? input.url : String(input)).href;
  } catch {
    return null;
  }
}

/** `fetch`, telling `auth` what each 401 of the MCP server itself asked for — before the SDK sees it and runs its OAuth
 *  (provider.ts decides from that whether the 401 is a sign-in at all). Discovery and token requests aren't the server's. */
function noting(fetchFn: typeof fetch, serverUrl: string, auth: ConnectionProvider): typeof fetch {
  const endpoint = new URL(serverUrl).href;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetchFn(input, init);
    if (res.status === 401 && hrefOf(input) === endpoint) auth.noteUnauthorized(res.headers.get("www-authenticate"));
    return res;
  }) as typeof fetch;
}

export async function openMcp(
  target: { url: string; headers: Readonly<Record<string, string>> },
  opts: { fetch: typeof fetch; timeoutMs: number; signal?: AbortSignal; authProvider?: ConnectionProvider },
): Promise<McpConnection> {
  const auth = opts.authProvider;
  const transport = new StreamableHTTPClientTransport(new URL(target.url), {
    fetch: auth ? noting(opts.fetch, target.url, auth) : opts.fetch,
    requestInit: { headers: { ...target.headers } },
    // Step-up is the person's to do from «Conectar»: the transport hands the 403 back instead of reauthorizing.
    ...(auth && { authProvider: auth, onInsufficientScope: "throw" as const }),
  });
  const client = new Client({ name: "openlen-len", version: "1.0.0" });
  try {
    await bounded(client.connect(transport, { timeout: opts.timeoutMs, signal: opts.signal }), opts.timeoutMs, "connecting", opts.signal);
  } catch (err) {
    await client.close().catch(() => {});
    // A 401 that isn't a sign-in (spec local 2026-11-17-oauth-de-conectores-mcp, §5.1; provider.ts): connect again as
    // with OAuth off, so the failure the person and Len read is that one, word for word.
    if (auth && err instanceof NotASignIn) return openMcp(target, { fetch: opts.fetch, timeoutMs: opts.timeoutMs, ...(opts.signal && { signal: opts.signal }) });
    throw (await asNeedsSignIn(auth, err)) ?? err;
  }
  const caps = client.getServerCapabilities() ?? {};
  const info = client.getServerVersion();
  const hasResources = caps.resources !== undefined;
  const request = { timeout: opts.timeoutMs, signal: opts.signal };
  return {
    serverInfo: { name: info?.name ?? "", version: info?.version ?? "" },
    instructions: client.getInstructions() ?? "",
    capabilities: { tools: caps.tools !== undefined, resources: hasResources, toolsListChanged: caps.tools?.listChanged === true },
    async listTools() {
      if (caps.tools === undefined) return [];
      const out: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await bounded(client.listTools(cursor ? { cursor } : undefined, request), opts.timeoutMs, "listing the tools", opts.signal);
        out.push(...(r.tools as McpTool[]));
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      return out;
    },
    async callTool(rawName, args, o) {
      const r = await bounded(client.callTool({ name: rawName, arguments: args }, { timeout: o.timeoutMs, signal: o.signal }), o.timeoutMs, "the call", o.signal);
      return r as McpCallResult;
    },
    async listResources(cursor) {
      if (!hasResources) return { resources: [] };
      return bounded(client.listResources(cursor ? { cursor } : undefined, request), opts.timeoutMs, "listing the resources", opts.signal);
    },
    async listResourceTemplates(cursor) {
      if (!hasResources) return { resourceTemplates: [] };
      return bounded(client.listResourceTemplates(cursor ? { cursor } : undefined, request), opts.timeoutMs, "listing the resource templates", opts.signal);
    },
    async readResource(uri) {
      if (!hasResources) throw new Error("this server has no resources");
      return bounded(client.readResource({ uri }, request), opts.timeoutMs, "reading the resource", opts.signal);
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}
