// AN MCP CLIENT FOR A TOOL'S OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): MCP's Streamable HTTP
// transport (modelcontextprotocol.io, «Transports»), as Claude Code and DeepSeek's `dsh-mcp-client` speak it to a server:
// JSON-RPC 2.0 over POST, `initialize` first (and `notifications/initialized`), its `Mcp-Session-Id` and protocol version
// on every later request, and an answer that is either JSON or an SSE stream holding the response with the request's id.
// The transport is injected (`McpSend`): OpenLen calls the tool's Edge Function in-process, through the functions gateway.
// Every exchange is bounded — a server that hangs or answers megabytes ends as an `McpError`, never a stuck turn.

export type McpSend = (body: string, headers: Record<string, string>) => Promise<Response>;

export interface McpTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

/** MCP's own `CallToolResult`: what Len reads back. */
export interface McpCallResult {
  readonly content: unknown[];
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

export type McpErrorCode = "timeout" | "too_large" | "http" | "protocol" | "rpc";

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** The protocol version OpenLen asks for; the server answers the one it speaks. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TIMEOUT_MS = 30_000;
export const MCP_MAX_BYTES = 256 * 1024;
const MAX_PAGES = 10;

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new McpError("too_large", `the server answered more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The JSON-RPC message with `id` in an SSE stream (`data:` lines of each event, joined). */
function fromSse(text: string, id: number): Record<string, unknown> | null {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const m = record(JSON.parse(data));
      if (m && m.id === id) return m;
    } catch {
      /* not JSON: another event */
    }
  }
  return null;
}

export function mcpSession(
  send: McpSend,
  o: { readonly timeoutMs?: number; readonly maxBytes?: number } = {},
): { listTools(): Promise<McpTool[]>; callTool(name: string, args: unknown): Promise<McpCallResult> } {
  const timeoutMs = o.timeoutMs ?? MCP_TIMEOUT_MS;
  const maxBytes = o.maxBytes ?? MCP_MAX_BYTES;
  let nextId = 1;
  let ready: Promise<void> | null = null;
  const session: Record<string, string> = {};

  const withTimeout = <T,>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new McpError("timeout", `the server didn't answer in ${timeoutMs} ms`)), timeoutMs);
    });
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
  };

  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...session,
  });

  async function exchange(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = nextId++;
    return withTimeout(
      (async () => {
        const res = await send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), headers());
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          throw new McpError("http", `HTTP ${res.status} from the server`);
        }
        const sessionId = res.headers.get("mcp-session-id");
        if (sessionId) session["mcp-session-id"] = sessionId;
        const text = await readBounded(res, maxBytes);
        let message: Record<string, unknown> | null = null;
        if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) message = fromSse(text, id);
        else {
          try {
            message = record(JSON.parse(text));
          } catch {
            message = null;
          }
        }
        if (!message || message.id !== id) throw new McpError("protocol", `no JSON-RPC answer to ${method}`);
        const error = record(message.error);
        if (error) throw new McpError("rpc", typeof error.message === "string" ? error.message : `${method} failed`);
        const result = record(message.result);
        if (!result) throw new McpError("protocol", `${method} answered without a result`);
        return result;
      })(),
    );
  }

  async function notify(method: string): Promise<void> {
    await withTimeout(
      (async () => {
        const res = await send(JSON.stringify({ jsonrpc: "2.0", method }), headers());
        await res.body?.cancel().catch(() => undefined);
      })(),
    );
  }

  const initialized = (): Promise<void> =>
    (ready ??= (async () => {
      const init = await exchange("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "openlen", version: "1" },
      });
      session["mcp-protocol-version"] = typeof init.protocolVersion === "string" ? init.protocolVersion : MCP_PROTOCOL_VERSION;
      await notify("notifications/initialized");
    })());

  return {
    async listTools() {
      await initialized();
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await exchange("tools/list", cursor ? { cursor } : {});
        for (const t of Array.isArray(r.tools) ? r.tools : []) {
          const tool = record(t);
          const inputSchema = record(tool?.inputSchema);
          if (!tool || typeof tool.name !== "string" || !inputSchema) continue;
          tools.push({
            name: tool.name,
            ...(typeof tool.title === "string" ? { title: tool.title } : {}),
            ...(typeof tool.description === "string" ? { description: tool.description } : {}),
            inputSchema,
          });
        }
        cursor = typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined;
        if (!cursor) break;
      }
      return tools;
    },
    async callTool(name, args) {
      await initialized();
      const r = await exchange("tools/call", { name, arguments: args ?? {} });
      return {
        content: Array.isArray(r.content) ? r.content : [],
        ...(r.isError === true ? { isError: true } : {}),
        ...(r.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}),
      };
    },
  };
}
