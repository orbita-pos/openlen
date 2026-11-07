import { describe, expect, it } from "vitest";

import type { McpConnection } from "./client";
import { entryFingerprint, parseMcpConfig } from "./config";
import type { ServerState } from "./store";
import { connectorsForTurn, RESOURCE_TOOL_NAMES, TurnConnections, type CallDeps, type TurnDeps } from "./turn";

const NOW = new Date("2026-11-06T12:00:00Z");
const obj = { type: "object", properties: {} };
const entry = (url: string, extra: Record<string, unknown> = {}) => ({ transport: "streamable-http", url, headers: { Authorization: "Bearer ${credential:TOK}" }, ...extra });

function setup(servers: Record<string, Record<string, unknown>>, approvedNames: string[], states: Partial<ServerState>[]) {
  const text = JSON.stringify({ servers });
  const parsed = parseMcpConfig(text, { reservedServerNames: new Set() });
  if (!parsed.ok) throw new Error(parsed.error);
  const fp = (n: string) => entryFingerprint(parsed.config.servers[n]!);
  const approved = Object.fromEntries(approvedNames.map((n) => [n, fp(n)]));
  const full: ServerState[] = states.map((s) => ({
    serverName: "x",
    fingerprint: fp(s.serverName ?? "x"),
    tools: [],
    instructions: "",
    hasResources: false,
    listedAt: NOW,
    status: "connected",
    error: null,
    stale: false,
    ...s,
  }));
  const d: TurnDeps = { readConfig: async () => ({ text, approved, version: 3 }), readStates: async () => full, now: () => NOW };
  return { d, fp };
}

const tool = (server: string, raw: string, bytes = 0) => ({ publicName: `mcp__${server}__${raw}`, rawName: raw, description: "d".repeat(bytes) || raw, inputSchema: obj });

describe("connectorsForTurn", () => {
  it("no servers, no declarations and empty context", async () => {
    const { d } = setup({}, [], []);
    const t = await connectorsForTurn("p1", d);
    expect(t.declarations).toEqual([]);
    expect(t.contextText).toBe("");
    expect(t.routes.size).toBe(0);
  });

  it("declarations are sorted and come from stored lists only", async () => {
    const { d } = setup({ zeta: entry("https://z.example.com/mcp"), alpha: entry("https://a.example.com/mcp") }, ["zeta", "alpha"], [
      { serverName: "zeta", tools: [tool("zeta", "b"), tool("zeta", "a")] },
      { serverName: "alpha", tools: [tool("alpha", "q")] },
    ]);
    const t = await connectorsForTurn("p1", d);
    const names = t.declarations.map((x) => x.name);
    expect(names.slice(0, 3)).toEqual(["mcp__alpha__q", "mcp__zeta__a", "mcp__zeta__b"]);
    expect(names.slice(3)).toEqual([...RESOURCE_TOOL_NAMES]);
    expect(t.routes.get("mcp__zeta__a")).toEqual({ server: "zeta", rawName: "a" });
    expect(t.contextText).toContain('Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: ["alpha","zeta"].');
    expect(t.serverNames).toEqual(["alpha", "zeta"]);
  });

  it("pending and waiting servers appear only as context lines", async () => {
    const { d } = setup({ ok: entry("https://ok.example.com/mcp"), pend: entry("https://p.example.com/mcp"), wait: entry("https://w.example.com/mcp") }, ["ok", "wait"], [
      { serverName: "ok", tools: [tool("ok", "a")] },
      { serverName: "wait", status: "waiting-credentials", error: "missing: TOK", listedAt: null },
    ]);
    const t = await connectorsForTurn("p1", d);
    expect([...t.routes.keys()]).toEqual(["mcp__ok__a"]);
    expect(t.contextText).toContain("- pend: pending approval");
    expect(t.contextText).toContain("- wait: waiting-credentials: TOK");
    expect(t.contextText).not.toContain(NOW.toISOString().slice(0, 10));
  });

  it("server instructions go under the server's name", async () => {
    const { d } = setup({ ok: entry("https://ok.example.com/mcp") }, ["ok"], [{ serverName: "ok", tools: [tool("ok", "a")], instructions: "Search before you write." }]);
    const t = await connectorsForTurn("p1", d);
    expect(t.contextText).toContain("## MCP server: ok\nSearch before you write.");
    expect(t.contextText.startsWith("<system-reminder>")).toBe(true);
  });

  it("caps keep the oldest server's tools", async () => {
    const many = (s: string, n: number) => Array.from({ length: n }, (_, i) => tool(s, `t${i}`));
    const { d } = setup({ young: entry("https://y.example.com/mcp"), old: entry("https://o.example.com/mcp") }, ["young", "old"], [
      { serverName: "young", tools: many("young", 100), listedAt: new Date("2026-11-06T00:00:00Z") },
      { serverName: "old", tools: many("old", 100), listedAt: new Date("2026-11-01T00:00:00Z") },
    ]);
    const t = await connectorsForTurn("p1", d);
    const declared = [...t.routes.keys()];
    expect(declared.filter((n) => n.startsWith("mcp__old__"))).toHaveLength(100);
    expect(declared.filter((n) => n.startsWith("mcp__young__"))).toHaveLength(28);
    expect(t.contextText).toContain("- young: 72 tools didn't fit");
  });

  it("a changed entry not yet re-listed declares nothing", async () => {
    const { d } = setup({ ok: entry("https://ok.example.com/mcp") }, ["ok"], [{ serverName: "ok", tools: [tool("ok", "a")], fingerprint: "old" }]);
    const t = await connectorsForTurn("p1", d);
    expect(t.routes.size).toBe(0);
    expect(t.toMount).toEqual(["ok"]);
  });
});

function connection(over: Partial<McpConnection> = {}) {
  const calls: string[] = [];
  let closed = 0;
  const c: McpConnection = {
    serverInfo: { name: "s", version: "1" },
    instructions: "",
    capabilities: { tools: true, resources: true, toolsListChanged: false },
    listTools: async () => [],
    callTool: async (raw) => {
      calls.push(raw);
      return { content: [{ type: "text", text: `ran ${raw}` }] };
    },
    listResources: async () => ({ resources: [{ uri: "a://b", name: "b" }] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({ contents: [{ uri: "a://b", blob: "QUJD" }] }),
    close: async () => {
      closed++;
    },
    ...over,
  };
  return { c, calls, closedCount: () => closed };
}

async function turnWith(over: Partial<McpConnection> = {}) {
  const { d } = setup({ ok: entry("https://ok.example.com/mcp") }, ["ok"], [{ serverName: "ok", tools: [tool("ok", "search")], hasResources: true }]);
  const turn = await connectorsForTurn("p1", d);
  const conn = connection(over);
  let opens = 0;
  const stale: string[] = [];
  const cd: CallDeps = {
    resolveCredentials: async () => new Map([["TOK", "tok123"]]),
    open: async () => {
      opens++;
      return conn.c;
    },
    fetch: (async () => new Response()) as typeof fetch,
    markStale: async (_p, s) => {
      stale.push(s);
    },
    modelTakesImages: true,
  };
  return { tc: new TurnConnections("p1", turn, cd), conn, opens: () => opens, stale };
}

describe("TurnConnections", () => {
  it("call opens once and reuses the connection", async () => {
    const { tc, conn, opens } = await turnWith();
    expect((await tc.call("mcp__ok__search", {})).response).toEqual({ content: [{ type: "text", text: "ran search" }] });
    await tc.call("mcp__ok__search", {});
    expect(opens()).toBe(1);
    expect(conn.calls).toEqual(["search", "search"]);
  });

  it("call that times out says it may have completed", async () => {
    const { tc } = await turnWith({
      callTool: async () => {
        throw new Error("the call took longer than 60 s");
      },
    });
    const text = JSON.stringify((await tc.call("mcp__ok__search", {})).response);
    expect(text).toContain("isError");
    expect(text).toContain("ok:");
    expect(text).toContain("It may have completed: check before calling it again.");
  });

  it("unknown tool marks the server stale", async () => {
    const { tc, stale } = await turnWith({
      callTool: async () => {
        throw new Error("MCP error -32602: Tool search not found");
      },
    });
    await tc.call("mcp__ok__search", {});
    expect(stale).toEqual(["ok"]);
  });

  it("an error naming the key is redacted", async () => {
    const { tc } = await turnWith({
      callTool: async () => {
        throw new Error("401 for tok123");
      },
    });
    expect(JSON.stringify((await tc.call("mcp__ok__search", {})).response)).not.toContain("tok123");
  });

  it("resource tools refuse an unknown server before any request", async () => {
    const { tc, opens } = await turnWith();
    const r = await tc.resource("list_mcp_resources", { server: "nope" });
    expect((r.response.content as { text: string }[])[0]!.text).toBe('nope isn\'t one of your MCP servers: ["ok"]');
    expect(opens()).toBe(0);
  });

  it("resource tools read with the server's name and no blob", async () => {
    const { tc } = await turnWith();
    const r = await tc.resource("read_mcp_resource", { server: "ok", uri: "a://b" });
    const text = JSON.stringify(r.response);
    expect(text).toContain("MCP server: ok");
    expect(text).not.toContain("QUJD");
  });

  it("closeAll closes every opened connection", async () => {
    const { tc, conn } = await turnWith();
    await tc.call("mcp__ok__search", {});
    await tc.closeAll();
    expect(conn.closedCount()).toBe(1);
  });
});
