// @vitest-environment node
//
// The connector client end to end against a real MCP server of the official SDK (McpServer over its web-standard
// Streamable HTTP transport), with no sockets: the client's fetch hands each Request to the server's handler.
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import * as z from "zod4";

import { openMcp } from "./client";

function server(opts: { resources?: boolean; instructions?: string } = {}) {
  const methods: string[] = [];
  const handler = async (req: Request): Promise<Response> => {
    const body = req.method === "POST" ? await req.clone().text() : "";
    for (const m of body.matchAll(/"method":"([^"]+)"/g)) methods.push(m[1]!);
    const mcp = new McpServer({ name: "fake", version: "1.2.3" }, { instructions: opts.instructions });
    mcp.registerTool("search", { description: "Search", inputSchema: { q: z.string() } }, async ({ q }) => ({ content: [{ type: "text" as const, text: `found ${q}` }] }));
    mcp.registerTool("fail", { description: "Fails", inputSchema: {} }, async () => ({ isError: true, content: [{ type: "text" as const, text: "nope" }] }));
    if (opts.resources) {
      mcp.registerResource("menu", "menu://today", { mimeType: "text/plain" }, async () => ({ contents: [{ uri: "menu://today", text: "soup" }] }));
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await mcp.connect(transport);
    return transport.handleRequest(req);
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof globalThis.fetch;
  return { fetch, methods };
}

const target = { url: "https://mcp.test/mcp", headers: { authorization: "Bearer t" } };

describe("openMcp", () => {
  it("reads instructions, identity and capabilities from initialize", async () => {
    const s = server({ instructions: "Use search for everything." });
    const c = await openMcp(target, { fetch: s.fetch, timeoutMs: 5000 });
    expect(c.instructions).toBe("Use search for everything.");
    expect(c.serverInfo).toEqual({ name: "fake", version: "1.2.3" });
    expect(c.capabilities.tools).toBe(true);
    expect(c.capabilities.resources).toBe(false);
    await c.close();
  });

  it("lists every tool", async () => {
    const s = server();
    const c = await openMcp(target, { fetch: s.fetch, timeoutMs: 5000 });
    expect((await c.listTools()).map((t) => t.name).sort()).toEqual(["fail", "search"]);
    await c.close();
  });

  it("callTool sends the raw name and returns MCP's result", async () => {
    const s = server();
    const c = await openMcp(target, { fetch: s.fetch, timeoutMs: 5000 });
    expect(await c.callTool("search", { q: "soup" }, { timeoutMs: 5000 })).toMatchObject({ content: [{ type: "text", text: "found soup" }] });
    expect(await c.callTool("fail", {}, { timeoutMs: 5000 })).toMatchObject({ isError: true });
    await c.close();
  });

  it("server without resources answers empty lists without a request", async () => {
    const s = server();
    const c = await openMcp(target, { fetch: s.fetch, timeoutMs: 5000 });
    const before = s.methods.length;
    expect(await c.listResources()).toEqual({ resources: [] });
    expect(await c.listResourceTemplates()).toEqual({ resourceTemplates: [] });
    expect(s.methods.length).toBe(before);
    await c.close();
  });

  it("reads a resource from a server that has them", async () => {
    const s = server({ resources: true });
    const c = await openMcp(target, { fetch: s.fetch, timeoutMs: 5000 });
    expect(c.capabilities.resources).toBe(true);
    expect(await c.listResources()).toMatchObject({ resources: [{ uri: "menu://today" }] });
    expect(await c.readResource("menu://today")).toMatchObject({ contents: [{ text: "soup" }] });
    await c.close();
  });
});
