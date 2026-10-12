// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), revokeConnection: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/connections", () => ({ revokeConnection: m.revokeConnection }));

import { DELETE } from "./route";

const del = (headers: Record<string, string> = {}) =>
  DELETE(new Request("http://x/api/mcp/connections/fam-1", { method: "DELETE", headers }), { params: Promise.resolve({ id: "fam-1" }) });

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("DELETE /api/mcp/connections/[id]", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
  });
  it("la tuya: 200", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.revokeConnection.mockResolvedValue(true);
    expect((await del()).status).toBe(200);
    expect(m.revokeConnection).toHaveBeenCalledWith("u1", "fam-1");
  });
  it("🔴 una ajena o inexistente: 404", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.revokeConnection.mockResolvedValue(false);
    expect((await del()).status).toBe(404);
  });
  it("🔴 desde otra web: 403 sin revocar", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await del({ origin: "https://evil.example" })).status).toBe(403);
    expect(m.revokeConnection).not.toHaveBeenCalled();
  });
});
