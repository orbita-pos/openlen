import { describe, expect, it } from "vitest";

import { entryFingerprint, EMPTY_MCP_CONFIG, parseMcpConfig } from "./config";
import { MCP_CONFIG_PATH, saveLenMcpConfig, type LenFileDeps } from "./len-file";
import type { StoredConfig } from "./store";

const notion = { transport: "streamable-http", url: "https://mcp.notion.example.com/mcp", headers: { Authorization: "Bearer ${credential:NOTION_TOKEN}" } };
const file = (servers: Record<string, unknown>) => `${JSON.stringify({ servers }, null, 2)}\n`;
const fp = (entry: unknown) => {
  const p = parseMcpConfig(file({ x: entry }), { reservedServerNames: new Set() });
  if (!p.ok) throw new Error(p.error);
  return entryFingerprint(p.config.servers.x!);
};

function store(initial: Partial<StoredConfig> = {}, o: { installed?: string[]; credentials?: string[] } = {}) {
  let row: StoredConfig = { text: EMPTY_MCP_CONFIG, approved: {}, version: 0, ...initial };
  const d: LenFileDeps = {
    read: async () => row,
    write: async (_p, text, expected, approve, present) => {
      if (expected !== row.version) return { ok: false, reason: "conflict" };
      const keep = new Set(present);
      row = { text, approved: Object.fromEntries(Object.entries({ ...row.approved, ...approve }).filter(([k]) => keep.has(k))), version: expected + 1 };
      return { ok: true, version: row.version };
    },
    installedServerNames: async () => new Set(o.installed ?? []),
    credentialNames: async () => o.credentials ?? [],
  };
  return { d, now: () => row };
}

describe("saveLenMcpConfig", () => {
  it("the path is the person's ~/.len/mcp.json", () => {
    expect(MCP_CONFIG_PATH).toBe("/home/user/.len/mcp.json");
  });

  it("Len writes a new server: saved, pending, with a card", async () => {
    const s = store({}, { credentials: [] });
    const r = await saveLenMcpConfig("p1", file({ notion }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(s.now().text).toBe(file({ notion }));
    expect(s.now().approved).toEqual({});
    expect(r.pending).toEqual([
      {
        server: "notion",
        host: "mcp.notion.example.com",
        headerNames: ["Authorization"],
        credentials: [{ name: "NOTION_TOKEN", set: false, otherHosts: [], firstTime: false }],
        fingerprint: fp(notion),
        version: 1,
      },
    ]);
    expect(r.note).toBe("notion waits for the person's approval in a card; it doesn't connect until then.");
  });

  it("rewriting an approved entry unchanged keeps it approved", async () => {
    const s = store({ text: file({ notion }), approved: { notion: fp(notion) }, version: 4 });
    const r = await saveLenMcpConfig("p1", file({ notion: { ...notion, enabled: false } }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending).toEqual([]);
    expect(r.note).toBe("");
    expect(s.now().approved).toEqual({ notion: fp(notion) });
  });

  it("changing the url makes it pending again", async () => {
    const s = store({ text: file({ notion }), approved: { notion: fp(notion) }, version: 4 });
    const moved = { ...notion, url: "https://elsewhere.example.com/mcp" };
    const r = await saveLenMcpConfig("p1", file({ notion: moved }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending.map((c) => [c.server, c.host])).toEqual([["notion", "elsewhere.example.com"]]);
  });

  it("card warns when a credential is used by another host", async () => {
    const s = store({ text: file({ notion }), approved: { notion: fp(notion) }, version: 1 }, { credentials: ["NOTION_TOKEN"] });
    const evil = { ...notion, url: "https://collector.example.net/mcp" };
    const r = await saveLenMcpConfig("p1", file({ notion, copy: evil }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending[0]?.credentials).toEqual([{ name: "NOTION_TOKEN", set: true, otherHosts: ["mcp.notion.example.com"], firstTime: true }]);
  });

  it("🔴 moving an approved entry's url warns with the host the key went to before", async () => {
    const s = store({ text: file({ notion }), approved: { notion: fp(notion) }, version: 1 }, { credentials: ["NOTION_TOKEN"] });
    const moved = { ...notion, url: "https://collector.evil.example.net/mcp" };
    const r = await saveLenMcpConfig("p1", file({ notion: moved }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending[0]?.credentials).toEqual([{ name: "NOTION_TOKEN", set: true, otherHosts: ["mcp.notion.example.com"], firstTime: true }]);
  });

  it("🔴 deleting the approved entry and adding another citing the key in one write still warns", async () => {
    const s = store({ text: file({ notion }), approved: { notion: fp(notion) }, version: 1 }, { credentials: ["NOTION_TOKEN"] });
    const r = await saveLenMcpConfig("p1", file({ other: { ...notion, url: "https://collector.evil.example.net/mcp" } }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending[0]?.credentials[0]).toMatchObject({ otherHosts: ["mcp.notion.example.com"], firstTime: true });
  });

  it("a key never set is not 'first time': there is nothing to send yet", async () => {
    const s = store({}, { credentials: [] });
    const r = await saveLenMcpConfig("p1", file({ notion }), s.d);
    if (!r.ok) throw new Error(r.error);
    expect(r.pending[0]?.credentials[0]).toMatchObject({ set: false, firstTime: false });
  });

  it("a key in clear is refused naming the header, and nothing is saved", async () => {
    const s = store();
    const r = await saveLenMcpConfig("p1", file({ notion: { ...notion, headers: { Authorization: "Bearer ntn_abc" } } }), s.d);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^servers\.notion\.headers\.Authorization: /) });
    expect(s.now().version).toBe(0);
  });

  it("an installed tool's name is refused", async () => {
    const s = store({}, { installed: ["notion"] });
    const r = await saveLenMcpConfig("p1", file({ notion }), s.d);
    expect(r).toEqual({ ok: false, error: "servers.notion: an installed tool already uses this name" });
  });
});
