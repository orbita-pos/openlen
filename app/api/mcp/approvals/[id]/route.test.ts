// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), decideApproval: vi.fn(), getApprovalForUser: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/approvals", () => ({ decideApproval: m.decideApproval, getApprovalForUser: m.getApprovalForUser }));

import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("http://x/api/mcp/approvals/abc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "abc" }),
  });

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("decidir una aprobación", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await call({ decision: "approve" })).status).toBe(401);
  });
  it("una que no es tuya (o no existe): 404", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.getApprovalForUser.mockResolvedValue(null);
    expect((await call({ decision: "approve" })).status).toBe(404);
  });
  it("la tuya, pendiente: se decide", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.getApprovalForUser.mockResolvedValue({ id: "abc", status: "pending" });
    m.decideApproval.mockResolvedValue(true);
    const res = await call({ decision: "deny" });
    expect(res.status).toBe(200);
    expect(m.decideApproval).toHaveBeenCalledWith("abc", "u1", "deny");
  });
  it("ya decidida o caducada: 409", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.getApprovalForUser.mockResolvedValue({ id: "abc", status: "approved" });
    m.decideApproval.mockResolvedValue(false);
    expect((await call({ decision: "approve" })).status).toBe(409);
  });
  it("un cuerpo raro: 400", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await call({ decision: "maybe" })).status).toBe(400);
  });
  it("🔴 desde otra web: 403 y no decide nada", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new Request("http://x/api/mcp/approvals/abc", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ decision: "approve" }) }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(res.status).toBe(403);
    expect(m.decideApproval).not.toHaveBeenCalled();
  });
});
