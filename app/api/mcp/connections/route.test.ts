// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), listConnections: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/connections", () => ({ listConnections: m.listConnections }));

import { GET } from "./route";

const get = (query = "") => GET(new Request(`http://x/api/mcp/connections${query}`));

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("GET /api/mcp/connections", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
  it("con sesión: las suyas, sin caché", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.listConnections.mockResolvedValue([{ id: "fam-1", name: "Claude Code", createdAt: new Date("2026-10-11T00:00:00Z") }]);
    const res = await get();
    expect(m.listConnections).toHaveBeenCalledWith("u1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ connections: [{ id: "fam-1", name: "Claude Code", createdAt: "2026-10-11T00:00:00.000Z" }], next_cursor: null });
  });
  it("de 20 en 20, con el cursor de la siguiente", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.listConnections.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` })));
    const first = await (await get()).json();
    expect(first.connections).toHaveLength(20);
    expect(first.next_cursor).toBe("20");
    const second = await (await get("?cursor=20")).json();
    expect(second.connections.map((c: { id: string }) => c.id)).toEqual(["c20", "c21", "c22", "c23", "c24"]);
    expect(second.next_cursor).toBeNull();
  });
});
