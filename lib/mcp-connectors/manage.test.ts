import { describe, expect, it } from "vitest";

import { EMPTY_MCP_CONFIG, entryFingerprint, parseMcpConfig } from "./config";
import { listView, removeEntry, saveEntry, secretCredentialName, type ManageDeps } from "./manage";
import type { ServerState, StoredConfig } from "./store";

function deps(initial: Partial<StoredConfig> = {}, states: ServerState[] = []) {
  let row: StoredConfig = { text: EMPTY_MCP_CONFIG, approved: {}, version: 0, ...initial };
  const creds = new Map<string, string>();
  const mounted: string[] = [];
  const removedStates: string[] = [];
  const d: ManageDeps = {
    read: async () => row,
    write: async (_p, text, expected, approve, present) => {
      if (expected !== row.version) return { ok: false, reason: "conflict" };
      const keep = new Set(present);
      row = { text, approved: Object.fromEntries(Object.entries({ ...row.approved, ...approve }).filter(([k]) => keep.has(k))), version: expected + 1 };
      return { ok: true, version: row.version };
    },
    readStates: async () => states,
    deleteState: async (_p, n) => {
      removedStates.push(n);
    },
    credentialNames: async () => [...creds.keys()].map((name) => ({ name, updatedAt: new Date(0) })),
    setCredential: async (_p, n, v) => {
      creds.set(n, v);
    },
    installedServerNames: async () => new Set(),
    mount: async (_p, n) => {
      mounted.push(n);
      return null;
    },
  };
  return { d, row: () => row, creds, mounted, removedStates };
}

const URL1 = "https://mcp.example.com/mcp";

describe("saveEntry", () => {
  it("PUT validates like Len and marks approved", async () => {
    const s = deps();
    const r = await saveEntry("p1", "notion", { url: URL1, headers: { "X-Workspace": "acme" }, version: 0 }, s.d);
    expect(r).toMatchObject({ ok: true });
    const parsed = parseMcpConfig(s.row().text, { reservedServerNames: new Set() });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(s.row().approved).toEqual({ notion: entryFingerprint(parsed.config.servers.notion!) });
    expect(s.mounted).toEqual(["notion"]);
    const bad = await saveEntry("p1", "x", { url: "http://insecure.example.com", headers: {}, version: 1 }, s.d);
    expect(bad).toEqual({ ok: false, status: 400, error: "servers.x.url: must be an https:// URL" });
  });

  it("secret header becomes a credential and a template", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: {}, secretHeaders: { Authorization: "Bearer ntn_abc" }, version: 0 }, s.d);
    expect(s.creds.get("NOTION_AUTHORIZATION")).toBe("Bearer ntn_abc");
    expect(s.row().text).toContain("${credential:NOTION_AUTHORIZATION}");
    expect(s.row().text).not.toContain("ntn_abc");
  });

  it("a stale version is a conflict", async () => {
    const s = deps({ version: 2 });
    expect(await saveEntry("p1", "notion", { url: URL1, headers: {}, version: 1 }, s.d)).toEqual({ ok: false, status: 409, error: "changed" });
  });

  it("omitted headers keep the stored ones", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: { "X-Workspace": "acme" }, version: 0 }, s.d);
    await saveEntry("p1", "notion", { url: "https://other.example.com/mcp", version: 1 }, s.d);
    expect(s.row().text).toContain('"X-Workspace": "acme"');
    expect(s.row().text).toContain("other.example.com");
  });

  it("🔴 editing with a new header keeps the stored ones (mergeHeaders)", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: {}, secretHeaders: { Authorization: "Bearer t" }, version: 0 }, s.d);
    await saveEntry("p1", "notion", { url: URL1, headers: { "X-Workspace": "acme" }, mergeHeaders: true, version: 1 }, s.d);
    expect(s.row().text).toContain("${credential:NOTION_AUTHORIZATION}");
    expect(s.row().text).toContain('"X-Workspace": "acme"');
  });

  it("the credential name is the server and header, uppercased", () => {
    expect(secretCredentialName("my-notion", "X-Api-Key")).toBe("MY_NOTION_X_API_KEY");
  });
});

describe("removeEntry", () => {
  it("DELETE keeps credentials", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: {}, secretHeaders: { Authorization: "Bearer t" }, version: 0 }, s.d);
    expect(await removeEntry("p1", "notion", 1, s.d)).toEqual({ ok: true });
    expect(s.row().text).not.toContain("notion");
    expect(s.removedStates).toEqual(["notion"]);
    expect(s.creds.has("NOTION_AUTHORIZATION")).toBe(true);
  });
});

describe("listView", () => {
  it("GET never returns header or credential values", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: { "X-Workspace": "acme" }, secretHeaders: { Authorization: "Bearer ntn_secret" }, version: 0 }, s.d);
    const v = await listView("p1", s.d);
    const text = JSON.stringify(v);
    expect(text).not.toContain("ntn_secret");
    expect(text).not.toContain("acme");
    expect(v.servers[0]).toMatchObject({ name: "notion", host: "mcp.example.com", enabled: true, approved: true, status: "never-listed", headers: ["Authorization", "X-Workspace"] });
    expect(v.credentials.map((c) => c.name)).toEqual(["NOTION_AUTHORIZATION"]);
  });

  it("🔴 an approved entry Len moved warns on the page too: its key goes to the new host for the first time", async () => {
    const s = deps();
    await saveEntry("p1", "notion", { url: URL1, headers: {}, secretHeaders: { Authorization: "Bearer t" }, version: 0 }, s.d);
    const moved = s.row().text.replace("mcp.example.com", "collector.evil.example.net");
    const row = s.row();
    const d2 = { ...s.d, read: async () => ({ ...row, text: moved }) };
    const v = await listView("p1", d2);
    expect(v.servers[0]).toMatchObject({ name: "notion", approved: false, status: "pending" });
    expect(v.servers[0]?.approval?.credentials).toEqual([{ name: "NOTION_AUTHORIZATION", set: true, otherHosts: [], firstTime: true }]);
  });

  it("a server Len added waits, with its card", async () => {
    const text = JSON.stringify({ servers: { linear: { transport: "streamable-http", url: "https://mcp.linear.example.com/mcp", headers: { Authorization: "Bearer ${credential:LINEAR}" } } } });
    const s = deps({ text, version: 4 });
    const v = await listView("p1", s.d);
    expect(v.servers[0]).toMatchObject({ name: "linear", approved: false, status: "pending" });
    expect(v.servers[0]?.approval).toMatchObject({ server: "linear", host: "mcp.linear.example.com", version: 4, credentials: [{ name: "LINEAR", set: false, otherHosts: [] }] });
  });
});
