// @vitest-environment node
//
// THE MCP CLIENT (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): OpenLen asks a tool's MCP server, over MCP's
// Streamable HTTP, for its tools and calls them. Tested against the REAL server Len writes — `@modelcontextprotocol/server`
// from the functions catalog (lib/functions/vendor/2027-01), Supabase's example — and against fakes for what a server
// can do badly: answer by SSE, hang, or answer too much.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { McpError, mcpSession, type McpSend } from "./client";

const VENDOR = path.join(process.cwd(), "lib", "functions", "vendor", "2027-01");
const load = async <T,>(file: string) => (await import(pathToFileURL(path.join(VENDOR, file)).href)) as T;

type ServerModule = {
  McpServer: new (o: { name: string; version: string }) => {
    registerTool(name: string, config: Record<string, unknown>, handler: (args: Record<string, number>) => unknown): void;
  };
  createMcpHandler(factory: () => unknown): { fetch(req: Request): Promise<Response> };
};

async function realServer(): Promise<McpSend> {
  const { McpServer, createMcpHandler } = await load<ServerModule>("modelcontextprotocol-server.mjs");
  const { z } = await load<{ z: { object(o: unknown): unknown; number(): unknown } }>("zod.mjs");
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "mcp", version: "0.1.0" });
    server.registerTool(
      "add",
      { title: "Addition Tool", description: "Add two numbers together", inputSchema: z.object({ a: z.number(), b: z.number() }) },
      ({ a, b }) => ({ content: [{ type: "text", text: String(a! + b!) }] }),
    );
    return server;
  });
  return (body, headers) => handler.fetch(new Request("http://tool.example/functions/v1/mcp", { method: "POST", body, headers }));
}

describe("mcpSession against the real MCP server", () => {
  it("lists the tools with their schemas", async () => {
    const tools = await mcpSession(await realServer()).listTools();
    expect(tools.map((t) => t.name)).toEqual(["add"]);
    expect(tools[0]).toMatchObject({ title: "Addition Tool", description: "Add two numbers together", inputSchema: { type: "object" } });
  });

  it("calls a tool and returns MCP's own result", async () => {
    const r = await mcpSession(await realServer()).callTool("add", { a: 2, b: 3 });
    expect(r.content).toEqual([{ type: "text", text: "5" }]);
    expect(r.isError ?? false).toBe(false);
  });

  it("an unknown tool is an error result or a JSON-RPC error, never a crash", async () => {
    const s = mcpSession(await realServer());
    const out = await s.callTool("nope", {}).then(
      (r) => ({ isError: r.isError }),
      (e: unknown) => ({ code: (e as McpError).code }),
    );
    expect(out.isError === true || (out as { code?: string }).code === "rpc").toBe(true);
  });
});

describe("mcpSession against what a server can do badly", () => {
  const sse = (id: number, result: unknown) =>
    new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, { headers: { "content-type": "text/event-stream" } });

  it("an answer by SSE is read until its id", async () => {
    const send: McpSend = async (body) => {
      const req = JSON.parse(body) as { id?: number; method: string };
      if (req.method === "initialize") return sse(req.id!, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x", version: "1" } });
      if (req.id === undefined) return new Response(null, { status: 202 });
      return sse(req.id, { tools: [{ name: "ping", inputSchema: { type: "object" } }] });
    };
    expect((await mcpSession(send).listTools()).map((t) => t.name)).toEqual(["ping"]);
  });

  it("a server that never answers: timeout", async () => {
    const send: McpSend = () => new Promise(() => undefined);
    await expect(mcpSession(send, { timeoutMs: 50 }).listTools()).rejects.toMatchObject({ code: "timeout" });
  });

  it("an answer over the limit: too_large", async () => {
    const send: McpSend = async (body) => {
      const req = JSON.parse(body) as { id?: number };
      return Response.json({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-06-18", pad: "x".repeat(300_000) } });
    };
    await expect(mcpSession(send).listTools()).rejects.toMatchObject({ code: "too_large" });
  });

  it("an HTTP error: http, with its status", async () => {
    const send: McpSend = async () => new Response("nope", { status: 503 });
    await expect(mcpSession(send).listTools()).rejects.toMatchObject({ code: "http" });
  });
});
