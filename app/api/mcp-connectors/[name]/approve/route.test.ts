// @vitest-environment node
//
// «Conectar» (spec local 2026-11-06-conectores-mcp, §5.3): the person approves one entry of their ~/.len/mcp.json, as it
// was when the card was drawn, with the browser session; then it is mounted.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const fake = vi.hoisted(() => ({
  row: { text: "", approved: {} as Record<string, string>, version: 3 },
  credentials: new Map<string, string>(),
  approved: [] as unknown[][],
  mounted: [] as string[],
}));
vi.mock("@/lib/mcp-connectors/store", () => ({
  readMcpConfig: async () => fake.row,
  approve: async (p: string, name: string, fp: string, version: number) => {
    if (version !== fake.row.version) return false;
    fake.approved.push([p, name, fp, version]);
    return true;
  },
}));
vi.mock("@/lib/mcp-connectors/credentials", () => ({
  setCredential: async (_p: string, name: string, value: string) => {
    fake.credentials.set(name, value);
  },
}));
vi.mock("@/lib/mcp-connectors/real", () => ({
  realMountDeps: () => ({}),
}));
vi.mock("@/lib/mcp-connectors/mount", () => ({
  mountServer: async (_p: string, name: string) => {
    fake.mounted.push(name);
    return { serverName: name, status: "connected", tools: [{ publicName: "mcp__notion__search" }] };
  },
}));

const { auth } = await import("@/auth");
const { entryFingerprint, parseMcpConfig } = await import("@/lib/mcp-connectors/config");
const { POST } = await import("./route");

const ENTRY = { transport: "streamable-http", url: "https://mcp.notion.example.com/mcp", headers: { Authorization: "Bearer ${credential:NOTION_TOKEN}" } };
const TEXT = JSON.stringify({ servers: { notion: ENTRY } });
const parsed = parseMcpConfig(TEXT, { reservedServerNames: new Set() });
if (!parsed.ok) throw new Error(parsed.error);
const FP = entryFingerprint(parsed.config.servers.notion!);

const post = (body: unknown, name = "notion") =>
  POST(new Request(`http://x/api/mcp-connectors/${name}/approve`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ name }) });

beforeEach(() => {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  fake.row = { text: TEXT, approved: {}, version: 3 };
  fake.credentials.clear();
  fake.approved.length = 0;
  fake.mounted.length = 0;
});

describe("POST /api/mcp-connectors/[name]/approve", () => {
  it("approves with matching fingerprint and mounts", async () => {
    const res = await post({ fingerprint: FP, version: 3, credentials: { NOTION_TOKEN: "ntn_x" } });
    expect(res.status).toBe(200);
    expect(fake.credentials.get("NOTION_TOKEN")).toBe("ntn_x");
    expect(fake.approved).toEqual([["u1", "notion", FP, 3]]);
    expect(fake.mounted).toEqual(["notion"]);
    expect(await res.json()).toMatchObject({ state: { status: "connected", tools: 1 } });
  });

  it("409 when the entry changed", async () => {
    expect((await post({ fingerprint: "other", version: 3 })).status).toBe(409);
    expect((await post({ fingerprint: FP, version: 2 })).status).toBe(409);
    expect(fake.approved).toEqual([]);
  });

  it("refuses a credential the entry doesn't reference", async () => {
    const res = await post({ fingerprint: FP, version: 3, credentials: { OTHER: "x" } });
    expect(res.status).toBe(400);
    expect(fake.credentials.size).toBe(0);
    expect(fake.approved).toEqual([]);
  });

  it("🔴 with OPENLEN_MCP=0 nothing is approved, stored or mounted", async () => {
    vi.stubEnv("OPENLEN_MCP", "0");
    try {
      expect((await post({ fingerprint: FP, version: 3, credentials: { NOTION_TOKEN: "x" } })).status).toBe(404);
      expect(fake.credentials.size).toBe(0);
      expect(fake.approved).toEqual([]);
      expect(fake.mounted).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("401 without a session", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await post({ fingerprint: FP, version: 3 })).status).toBe(401);
  });
});
