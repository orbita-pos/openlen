// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), updateProfile: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/profile/store", () => ({ updateProfile: m.updateProfile }));

import { PATCH } from "./route";

const pedir = (body: unknown) =>
  new Request("http://localhost/api/me/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u-ana" } });
});

describe("PATCH /api/me/profile", () => {
  it("sin sesión, 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await PATCH(pedir({ bio: "hola" }))).status).toBe(401);
  });

  it("🔴 un enlace javascript: no se guarda, y se dice cuál", async () => {
    const r = await PATCH(pedir({ links: ["ana.dev", "javascript:alert(1)"] }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid", path: "links.1" });
    expect(m.updateProfile).not.toHaveBeenCalled();
  });

  it("🔴 lo válido se guarda normalizado, para quien pide (no para otro)", async () => {
    const r = await PATCH(pedir({ name: " Ana ", links: ["instagram.com/ana"], pinnedProjectIds: ["p1"] }));
    expect(r.status).toBe(200);
    expect(m.updateProfile).toHaveBeenCalledWith("u-ana", { name: "Ana", links: ["https://instagram.com/ana"], pinnedProjectIds: ["p1"] });
  });
});
