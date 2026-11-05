// @vitest-environment node
//
// INSTALLING FINDS THE OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): once, as the installer, from
// the live function the tool names — against the REAL `@modelcontextprotocol/server` of the functions catalog.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { McpSend } from "./client";
import { discoverOperations } from "./discover";

const VENDOR = path.join(process.cwd(), "lib", "functions", "vendor", "2027-01");
const load = async <T,>(file: string) => (await import(pathToFileURL(path.join(VENDOR, file)).href)) as T;

async function realServer(tools: Array<{ name: string }> = [{ name: "add" }]): Promise<McpSend> {
  const { McpServer, createMcpHandler } = await load<{
    McpServer: new (o: unknown) => { registerTool(n: string, c: unknown, h: () => unknown): void };
    createMcpHandler(f: () => unknown): { fetch(r: Request): Promise<Response> };
  }>("modelcontextprotocol-server.mjs");
  const { z } = await load<{ z: { object(o: unknown): unknown; number(): unknown } }>("zod.mjs");
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "mcp", version: "0.1.0" });
    for (const t of tools) server.registerTool(t.name, { description: "Add two numbers together", inputSchema: z.object({ a: z.number(), b: z.number() }) }, () => ({ content: [] }));
    return server;
  });
  return (body, headers) => handler.fetch(new Request("http://tool.example/functions/v1/mcp", { method: "POST", body, headers }));
}

const ask = (send: (toolProjectId: string, email: string, fn: string) => Promise<McpSend | null>) =>
  discoverOperations({ toolProjectId: "tool-1", email: "ana@example.com", mcp: { serverName: "calc", function: "mcp" } }, { send });

describe("discoverOperations", () => {
  it("asks the tool's live function as the installer and keeps the checked operations", async () => {
    const server = await realServer();
    const send = vi.fn(async () => server);
    const r = await ask(send);
    expect(send).toHaveBeenCalledWith("tool-1", "ana@example.com", "mcp");
    expect(r).toEqual({
      ok: true,
      mcp: { serverName: "calc", function: "mcp", tools: [{ name: "add", description: "Add two numbers together", inputSchema: expect.objectContaining({ type: "object" }) }] },
      problems: [],
    });
  });

  it("operations the provider couldn't take come back as problems, the rest stay", async () => {
    const server = await realServer([{ name: "add" }, { name: "add numbers" }]);
    const r = await ask(async () => server);
    expect(r.ok && r.mcp.tools.map((t) => t.name)).toEqual(["add"]);
    expect(r.ok && r.problems).toHaveLength(1);
  });

  it("no way to reach the function: not ok, unreachable", async () => {
    expect(await ask(async () => null)).toEqual({ ok: false, error: "unreachable" });
  });

  it("a function that doesn't answer MCP: not ok, with the reason", async () => {
    const r = await ask(async () => async () => new Response("boom", { status: 500 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("HTTP 500");
  });
});
