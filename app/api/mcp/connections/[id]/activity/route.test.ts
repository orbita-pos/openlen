// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), connectionActivity: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/mcp/connections", () => ({ connectionActivity: m.connectionActivity }));

import { GET } from "./route";

const get = () => GET(new Request("http://x"), { params: Promise.resolve({ id: "fam-1" }) });

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("GET /api/mcp/connections/[id]/activity", () => {
  it("sin sesión: 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
  it("la actividad de esa conexión, de esta persona", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.connectionActivity.mockResolvedValue([{ tool: "read_file", ok: true }]);
    expect(await (await get()).json()).toEqual({ activity: [{ tool: "read_file", ok: true }] });
    expect(m.connectionActivity).toHaveBeenCalledWith("u1", "fam-1");
  });
});
