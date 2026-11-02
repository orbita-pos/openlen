import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), runById: vi.fn(), stop: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/lib/agent/subagents/store", () => ({ runById: mocks.runById }));
vi.mock("@/lib/agent/subagents/registry", () => ({ stop: mocks.stop }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { POST } from "./route";

const stopIt = async (id = "r1") => {
  const res = await POST(new Request(`http://localhost/api/agent/subagents/${id}/stop`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.runById.mockResolvedValue({ id: "r1", projectId: "p1", personId: "u1" });
  mocks.stop.mockReturnValue(true);
});
afterEach(() => fijarAccesoDePrueba(null));

describe("POST /api/agent/subagents/[id]/stop", () => {
  it("the owner stops it", async () => {
    const { status, body } = await stopIt();
    expect(status).toBe(200);
    expect(mocks.stop).toHaveBeenCalledWith("r1");
    expect(body).toEqual({ stopped: true });
  });

  it("the member who launched it stops it", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "owner" }));
    expect((await stopIt()).body).toEqual({ stopped: true });
  });

  it("one that already ended answers stopped: false", async () => {
    mocks.stop.mockReturnValue(false);
    expect((await stopIt()).body).toEqual({ stopped: false });
  });

  it("a member who did not launch it gets the same 404 as an unknown id", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "owner" }));
    mocks.runById.mockResolvedValue({ id: "r1", projectId: "p1", personId: "someone-else" });
    expect((await stopIt()).status).toBe(404);
    mocks.runById.mockResolvedValue(null);
    expect((await stopIt()).status).toBe(404);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("someone with no access to the project gets a 404", async () => {
    fijarAccesoDePrueba(() => null);
    expect((await stopIt()).status).toBe(404);
    expect(mocks.stop).not.toHaveBeenCalled();
  });
});
