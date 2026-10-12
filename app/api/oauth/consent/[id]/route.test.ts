// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), decideConsent: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/oauth/consent", () => ({ decideConsent: m.decideConsent }));

import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "req1" }),
  });

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("POST /api/oauth/consent/[id]", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await call({ decision: "allow" })).status).toBe(401);
  });
  it("permitir: 200 con la redirección", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.decideConsent.mockResolvedValue({ ok: true, redirect: "http://127.0.0.1:1/cb?code=x&iss=y" });
    const res = await call({ decision: "allow", scopes: ["projects:read"], project_id: null });
    expect(res.status).toBe(200);
    expect(m.decideConsent).toHaveBeenCalledWith({ requestId: "req1", userId: "u1", approve: true, scopes: ["projects:read"], projectId: null });
    expect(await res.json()).toEqual({ redirect: "http://127.0.0.1:1/cb?code=x&iss=y" });
  });
  it("caducada: 410", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.decideConsent.mockResolvedValue({ ok: false, error: "expired" });
    expect((await call({ decision: "allow" })).status).toBe(410);
  });
  it("un cuerpo raro: 400", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await call({ decision: "maybe" })).status).toBe(400);
  });
  it("🔴 desde otra web: 403 y no decide nada", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ decision: "allow" }) }),
      { params: Promise.resolve({ id: "req1" }) },
    );
    expect(res.status).toBe(403);
    expect(m.decideConsent).not.toHaveBeenCalled();
  });
});
