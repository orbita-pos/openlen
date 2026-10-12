// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), createPersonalToken: vi.fn(), checkAndConsume: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/connections", () => ({ createPersonalToken: m.createPersonalToken }));
vi.mock("@/lib/limits", () => ({ checkAndConsume: m.checkAndConsume }));

import { POST } from "./route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/mcp/tokens", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.checkAndConsume.mockResolvedValue({ ok: true, remaining: [] });
});

describe("POST /api/mcp/tokens", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await post({ name: "x" })).status).toBe(401);
  });
  it("crea: 201 con el secreto (y sólo aquí), sin caché", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.createPersonalToken.mockResolvedValue({ ok: true, id: "t1", secret: "olp_x" });
    const res = await post({ name: "CI", scopes: ["publish", 3], project_id: "p1", expires_in_days: 90 });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "t1", token: "olp_x" });
    expect(m.createPersonalToken).toHaveBeenCalledWith("u1", { name: "CI", scopes: ["publish"], projectId: "p1", expiresInDays: 90 });
  });
  it("un proyecto que no puede abrir: 403", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.createPersonalToken.mockResolvedValue({ ok: false, error: "project_not_allowed" });
    expect((await post({ name: "x", project_id: "ajeno" })).status).toBe(403);
  });
  it("🔴 desde otra web: 403 sin crear", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await post({ name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(m.createPersonalToken).not.toHaveBeenCalled();
  });
  it("pasado el tope diario: 429", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.checkAndConsume.mockResolvedValue({ ok: false, remaining: [] });
    expect((await post({ name: "x" })).status).toBe(429);
  });
});
