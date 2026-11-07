// ONE CONNECTION TO A CONNECTOR (spec local 2026-11-06-conectores-mcp, §5.4): the official SDK, as DeepSeek's
// dsh-mcp-client uses it — the harness doesn't frame JSON-RPC itself. Its fetch is the guarded one (fetch.ts). A server
// that doesn't advertise `resources` answers empty lists without a request (DeepSeek). Every request is bounded.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { McpCallResult, McpTool } from "@/lib/tools/mcp/client";

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

export async function openMcp(
  target: { url: string; headers: Readonly<Record<string, string>> },
  opts: { fetch: typeof fetch; timeoutMs: number; signal?: AbortSignal },
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(target.url), { fetch: opts.fetch, requestInit: { headers: { ...target.headers } } });
  const client = new Client({ name: "openlen-len", version: "1.0.0" });
  try {
    await bounded(client.connect(transport, { timeout: opts.timeoutMs, signal: opts.signal }), opts.timeoutMs, "connecting", opts.signal);
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
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
