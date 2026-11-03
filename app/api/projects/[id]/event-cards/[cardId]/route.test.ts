// POST /api/projects/[id]/event-cards/[cardId] (spec local 2026-11-03-len-que-avisa, §7.7, §7.11): only an editor
// or the owner presses «Hazlo»; a reader gets 403; a card decided already gets 409.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/event-tasks/accept", () => ({ decideAndLaunch: vi.fn(), defaultAcceptDeps: vi.fn(async () => ({})) }));
vi.mock("@/lib/event-tasks/enabled", () => ({ eventTasksEnabled: () => true }));

const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const { exigirAcceso } = await import("@/lib/projects/acceso");
const { decideAndLaunch } = await import("@/lib/event-tasks/accept");
const { POST } = await import("./route");

const post = (action: string) =>
  POST(new Request("http://localhost/api/projects/p1/event-cards/c1", { method: "POST", body: JSON.stringify({ action }) }), { params: Promise.resolve({ id: "p1", cardId: "c1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u2");
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
  vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "accepted" });
});

describe("POST event-cards/[cardId]", () => {
  it("an editor accepts: 202", async () => {
    const res = await post("accept");
    expect(res.status).toBe(202);
    expect(vi.mocked(exigirAcceso)).toHaveBeenCalledWith("p1", "u2", "editar");
    expect(vi.mocked(decideAndLaunch)).toHaveBeenCalledWith({ projectId: "p1", cardId: "c1", action: "accept", actorId: "u2" }, expect.anything());
  });

  it("a reader (lector) cannot accept: 403", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }) as never);
    expect((await post("accept")).status).toBe(403);
    expect(vi.mocked(decideAndLaunch)).not.toHaveBeenCalled();
  });

  it("a second accept is 409 not_pending", async () => {
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: false, reason: "not_pending" });
    const res = await post("accept");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_pending" });
  });

  it("an unknown action is 400, and nobody signed in is 401", async () => {
    expect((await post("delete")).status).toBe(400);
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await post("accept")).status).toBe(401);
  });
});
