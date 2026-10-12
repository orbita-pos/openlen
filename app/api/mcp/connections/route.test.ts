// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), listConnections: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/connections", () => ({ listConnections: m.listConnections }));

import { GET } from "./route";

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("GET /api/mcp/connections", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("con sesión: las suyas, sin caché", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.listConnections.mockResolvedValue([{ id: "fam-1", name: "Claude Code", createdAt: new Date("2026-10-11T00:00:00Z") }]);
    const res = await GET();
    expect(m.listConnections).toHaveBeenCalledWith("u1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ connections: [{ id: "fam-1", name: "Claude Code", createdAt: "2026-10-11T00:00:00.000Z" }] });
  });
});
