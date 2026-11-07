// @vitest-environment node
//
// The «Conectores» section's API (spec local 2026-11-06-conectores-mcp, §5.7): the person's own, with the browser session,
// gone with OPENLEN_MCP=0. The logic is in lib/mcp-connectors/manage.ts (manage.test.ts); here, the doors.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const view = vi.hoisted(() => ({ listView: vi.fn(async () => ({ version: 2, servers: [], credentials: [] })), saveEntry: vi.fn(), removeEntry: vi.fn() }));
vi.mock("@/lib/mcp-connectors/manage", () => view);
vi.mock("@/lib/mcp-connectors/real", () => ({ realManageDeps: () => ({}) }));

const { auth } = await import("@/auth");
const { GET } = await import("./route");
const { PUT } = await import("./[name]/route");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/mcp-connectors", () => {
  it("GET lists the person's connectors", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ available: true, version: 2, servers: [], credentials: [] });
    expect(view.listView).toHaveBeenCalledWith("u1", {});
  });

  it("available false when OPENLEN_MCP=0", async () => {
    vi.stubEnv("OPENLEN_MCP", "0");
    expect(await (await GET()).json()).toEqual({ available: false });
    expect(view.listView).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("PUT passes what the person wrote, and refuses non-string headers", async () => {
    view.saveEntry.mockResolvedValue({ ok: true, view: { name: "notion" } });
    const put = (body: unknown) => PUT(new Request("http://x/api/mcp-connectors/notion", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ name: "notion" }) });
    expect((await put({ url: "https://x.example.com/mcp", version: 1, secretHeaders: { Authorization: "Bearer t" } })).status).toBe(200);
    expect(view.saveEntry).toHaveBeenCalledWith("u1", "notion", { url: "https://x.example.com/mcp", version: 1, secretHeaders: { Authorization: "Bearer t" } }, {});
    expect((await put({ url: "https://x.example.com/mcp", version: 1, headers: { A: 1 } })).status).toBe(400);
  });
});
