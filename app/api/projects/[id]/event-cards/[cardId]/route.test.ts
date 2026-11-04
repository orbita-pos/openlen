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

const post = (action: string, extra: Record<string, unknown> = {}) =>
  POST(new Request("http://localhost/api/projects/p1/event-cards/c1", { method: "POST", body: JSON.stringify({ action, ...extra }) }), { params: Promise.resolve({ id: "p1", cardId: "c1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u2");
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "dueno", duenoId: "u2" } as never);
  vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "accepted", results: [], rowId: "row-1", text: "🔔 T: Hazlo", origin: { kind: "event_task", taskId: "t1", cardId: "c1", title: "T" } });
});

describe("POST event-cards/[cardId]", () => {
  it("an editor can't decide a card: it carries what visitors sent, the owner's (review I8)", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
    expect((await post("accept")).status).toBe(403);
    expect(vi.mocked(decideAndLaunch)).not.toHaveBeenCalled();
  });

  it("the owner accepts: 202", async () => {
    const res = await post("accept");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted", results: [], rowId: "row-1", text: "🔔 T: Hazlo", origin: { kind: "event_task", taskId: "t1", cardId: "c1", title: "T" } });
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

  it("an editor can't accept, dismiss, look again or withdraw: 403", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" } as never);
    for (const action of ["accept", "dismiss", "look_again", "withdraw_send"]) expect((await post(action, { index: 0, note: "x" })).status).toBe(403);
    expect(vi.mocked(decideAndLaunch)).not.toHaveBeenCalled();
  });

  it("an accepted card with actions answers what each did", async () => {
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "accepted", results: [{ kind: "data_change", state: "done", error: null }] });
    const res = await post("accept");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted", results: [{ kind: "data_change", state: "done", error: null }] });
  });

  it("dismiss carries the owner's note, trimmed; an empty note is none", async () => {
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "dismissed", lookingAgain: true });
    const res = await post("dismiss", { note: "  Ofrécele la 8.  " });
    expect(await res.json()).toEqual({ status: "dismissed", lookingAgain: true });
    expect(vi.mocked(decideAndLaunch)).toHaveBeenLastCalledWith({ projectId: "p1", cardId: "c1", action: "dismiss", actorId: "u2", note: "Ofrécele la 8." }, expect.anything());
    await post("dismiss", { note: "   " });
    expect(vi.mocked(decideAndLaunch)).toHaveBeenLastCalledWith({ projectId: "p1", cardId: "c1", action: "dismiss", actorId: "u2", note: null }, expect.anything());
  });

  it("look_again and withdraw_send reach the card; withdraw_send needs the action's index", async () => {
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "looking_again" });
    expect(await (await post("look_again")).json()).toEqual({ status: "looking_again" });
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: true, status: "withdrawn" });
    expect((await post("withdraw_send", { index: 1 })).status).toBe(200);
    expect(vi.mocked(decideAndLaunch)).toHaveBeenLastCalledWith({ projectId: "p1", cardId: "c1", action: "withdraw_send", actorId: "u2", index: 1 }, expect.anything());
    expect((await post("withdraw_send")).status).toBe(400);
    expect((await post("withdraw_send", { index: "1" })).status).toBe(400);
  });

  it("a re-judge past the day's limit is 429 daily_limit; nothing blocked or sending is 409", async () => {
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: false, reason: "daily_limit" });
    const res = await post("look_again");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
    vi.mocked(decideAndLaunch).mockResolvedValue({ ok: false, reason: "not_blocked" });
    expect((await post("look_again")).status).toBe(409);
  });

  it("an unknown action is 400, and nobody signed in is 401", async () => {
    expect((await post("delete")).status).toBe(400);
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await post("accept")).status).toBe(401);
  });
});
