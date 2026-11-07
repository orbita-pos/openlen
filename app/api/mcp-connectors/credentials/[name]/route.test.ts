// @vitest-environment node
//
// One of the person's keys (spec local 2026-11-06-conectores-mcp, §5.2): set it, and the approved servers citing it are
// mounted outside the request; with OPENLEN_MCP=0 nothing is stored and nothing connects.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const fake = vi.hoisted(() => ({ set: [] as string[], mounted: [] as string[][] }));
vi.mock("@/lib/mcp-connectors/credentials", () => ({
  setCredential: async (_p: string, n: string) => {
    fake.set.push(n);
  },
  deleteCredential: async () => {},
}));
vi.mock("@/lib/mcp-connectors/store", () => ({ readMcpConfig: async () => ({ text: '{"servers":{}}', approved: {}, version: 1 }) }));
vi.mock("@/lib/mcp-connectors/real", () => ({
  mountInBackground: (_p: string, names: string[]) => {
    fake.mounted.push(names);
  },
}));

const { auth } = await import("@/auth");
const { PUT } = await import("./route");
const put = (name: string, value: string) => PUT(new Request(`http://x/api/mcp-connectors/credentials/${name}`, { method: "PUT", body: JSON.stringify({ value }) }), { params: Promise.resolve({ name }) });

beforeEach(() => {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  fake.set.length = 0;
  fake.mounted.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("PUT /api/mcp-connectors/credentials/[name]", () => {
  it("stores the key", async () => {
    expect((await put("NOTION_TOKEN", "v")).status).toBe(200);
    expect(fake.set).toEqual(["NOTION_TOKEN"]);
  });

  it("🔴 with OPENLEN_MCP=0 nothing is stored or mounted", async () => {
    vi.stubEnv("OPENLEN_MCP", "0");
    expect((await put("NOTION_TOKEN", "v")).status).toBe(404);
    expect(fake.set).toEqual([]);
    expect(fake.mounted).toEqual([]);
  });

  it("refuses a malformed name", async () => {
    expect((await put("lower", "v")).status).toBe(400);
  });
});
