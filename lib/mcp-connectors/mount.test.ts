import { describe, expect, it } from "vitest";

import { entryFingerprint, parseMcpConfig } from "./config";
import type { McpConnection } from "./client";
import { mountServer, probeServer, serversToMount, STALE_AFTER_MS, type MountDeps } from "./mount";
import type { ServerState } from "./store";

const NOW = new Date("2026-11-06T12:00:00Z");
const ENTRY = { transport: "streamable-http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer ${credential:TOK}" } };
const TEXT = JSON.stringify({ servers: { notion: ENTRY } });
const parsed = parseMcpConfig(TEXT, { reservedServerNames: new Set() });
if (!parsed.ok) throw new Error(parsed.error);
const FP = entryFingerprint(parsed.config.servers.notion!);
const obj = { type: "object", properties: {} };

function conn(over: Partial<McpConnection> = {}): McpConnection & { closed: boolean } {
  const c = {
    closed: false,
    serverInfo: { name: "notion", version: "1" },
    instructions: "",
    capabilities: { tools: true, resources: false, toolsListChanged: false },
    listTools: async () => [{ name: "search", inputSchema: obj }],
    callTool: async () => ({ content: [] }),
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({}),
    async close() {
      c.closed = true;
    },
    ...over,
  };
  return c;
}

function deps(o: { approved?: Record<string, string>; text?: string; creds?: Record<string, string>; states?: ServerState[]; open?: MountDeps["open"] } = {}) {
  const saved: ServerState[] = [];
  const opened: { url: string; headers: Record<string, string> }[] = [];
  const last = conn();
  const d: MountDeps = {
    readConfig: async () => ({ text: o.text ?? TEXT, approved: o.approved ?? { notion: FP }, version: 1 }),
    readStates: async () => o.states ?? [],
    saveState: async (_p, s) => {
      saved.push(s);
    },
    resolveCredentials: async (_p, names) => new Map(Object.entries(o.creds ?? { TOK: "tok123" }).filter(([k]) => names.includes(k))),
    open:
      o.open ??
      (async (target) => {
        opened.push({ url: target.url, headers: { ...target.headers } });
        return last;
      }),
    fetch: (async () => new Response()) as typeof fetch,
    now: () => NOW,
  };
  return { d, saved, opened, last };
}

const previous: ServerState = {
  serverName: "notion",
  fingerprint: FP,
  tools: [{ publicName: "mcp__notion__old", rawName: "old", description: "old", inputSchema: obj }],
  instructions: "before",
  hasResources: false,
  listedAt: new Date("2026-11-05T00:00:00Z"),
  status: "connected",
  error: null,
  stale: false,
};

describe("mountServer", () => {
  it("success stores the reviewed list", async () => {
    const { d, saved, opened, last } = deps();
    const s = await mountServer("p1", "notion", d);
    expect(opened[0]).toEqual({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer tok123" } });
    expect(s).toMatchObject({ status: "connected", error: null, stale: false, fingerprint: FP, listedAt: NOW });
    expect(s?.tools.map((t) => t.publicName)).toEqual(["mcp__notion__search"]);
    expect(saved).toHaveLength(1);
    expect(last.closed).toBe(true);
  });

  it("failure keeps the previous list and the redacted error", async () => {
    const { d, saved } = deps({
      states: [previous],
      open: async () => {
        throw new Error("401 bad token tok123");
      },
    });
    const s = await mountServer("p1", "notion", d);
    expect(s).toMatchObject({ status: "failed", error: "401 bad token [redacted]", listedAt: previous.listedAt, instructions: "before" });
    expect(s?.tools).toEqual(previous.tools);
    expect(saved).toHaveLength(1);
  });

  it("missing credential is waiting-credentials and lists nothing", async () => {
    const { d, opened } = deps({ creds: {} });
    const s = await mountServer("p1", "notion", d);
    expect(s).toMatchObject({ status: "waiting-credentials", error: "missing: TOK" });
    expect(opened).toEqual([]);
  });

  it("oversized instructions fail the mount", async () => {
    const { d } = deps({ states: [previous], open: async () => conn({ instructions: "i".repeat(33 * 1024) }) });
    const s = await mountServer("p1", "notion", d);
    expect(s).toMatchObject({ status: "failed", error: "server instructions are over 32 KB" });
    expect(s?.tools).toEqual(previous.tools);
  });

  it("a duplicate tool list keeps the previous one", async () => {
    const { d } = deps({ states: [previous], open: async () => conn({ listTools: async () => [{ name: "a", inputSchema: obj }, { name: "a", inputSchema: obj }] }) });
    const s = await mountServer("p1", "notion", d);
    expect(s).toMatchObject({ status: "failed" });
    expect(s?.error).toContain("duplicate tool name");
    expect(s?.tools).toEqual(previous.tools);
  });

  it("unapproved or disabled entries are not mounted", async () => {
    const a = deps({ approved: {} });
    expect(await mountServer("p1", "notion", a.d)).toBeNull();
    expect(a.opened).toEqual([]);
    const b = deps({ text: JSON.stringify({ servers: { notion: { ...ENTRY, enabled: false } } }) });
    expect(await mountServer("p1", "notion", b.d)).toBeNull();
    expect(b.opened).toEqual([]);
  });
});

describe("probeServer", () => {
  it("probe never saves", async () => {
    const { d, saved } = deps();
    const r = await probeServer("p1", "notion", d);
    expect(r).toEqual({ ok: true, serverInfo: { name: "notion", version: "1" }, tools: ["search"], problems: [] });
    expect(saved).toEqual([]);
  });

  it("🔴 probe refuses an entry the person hasn't approved: nothing connects without the tap", async () => {
    const { d, opened } = deps({ approved: {} });
    expect(await probeServer("p1", "notion", d)).toEqual({ ok: false, stage: "connect", error: "notion isn't approved yet: approve it first" });
    expect(opened).toEqual([]);
  });

  it("a disabled but approved entry can be probed, as in DeepSeek", async () => {
    const { d } = deps({ text: JSON.stringify({ servers: { notion: { ...ENTRY, enabled: false } } }) });
    expect((await probeServer("p1", "notion", d)).ok).toBe(true);
  });

  it("probe names the stage that failed, redacted", async () => {
    const { d } = deps({
      open: async () => {
        throw new Error("refused tok123");
      },
    });
    expect(await probeServer("p1", "notion", d)).toEqual({ ok: false, stage: "connect", error: "refused [redacted]" });
    expect(await probeServer("p1", "notion", deps({ creds: {} }).d)).toEqual({ ok: false, stage: "credentials", error: "missing: TOK" });
  });
});

describe("serversToMount", () => {
  const config = parsed.config;
  it("serversToMount picks stale, changed and old ones only", () => {
    expect(serversToMount([], config, { notion: FP }, NOW)).toEqual(["notion"]);
    expect(serversToMount([{ ...previous, listedAt: NOW }], config, { notion: FP }, NOW)).toEqual([]);
    expect(serversToMount([{ ...previous, listedAt: NOW, stale: true }], config, { notion: FP }, NOW)).toEqual(["notion"]);
    expect(serversToMount([{ ...previous, listedAt: NOW, fingerprint: "other" }], config, { notion: FP }, NOW)).toEqual(["notion"]);
    expect(serversToMount([{ ...previous, listedAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1) }], config, { notion: FP }, NOW)).toEqual(["notion"]);
    expect(serversToMount([], config, {}, NOW)).toEqual([]);
  });
});
