// @vitest-environment node
//
// THE «CREAR» CARD'S ROUTES (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the person's cards in a
// project, and a press on one. Only the workspace's browser session: a phone key alone is refused (phase 5).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/tools/cards/store", () => ({ cardsOfProject: vi.fn(), toCardView: (r: { id: string; phase: string }) => ({ id: r.id, phase: r.phase }) }));
vi.mock("@/lib/tools/cards/actions", () => ({ actOnCard: vi.fn(), realActionDeps: vi.fn(async () => ({})) }));

const { auth } = await import("@/auth");
const { exigirAcceso } = await import("@/lib/projects/acceso");
const { cardsOfProject } = await import("@/lib/tools/cards/store");
const { actOnCard } = await import("@/lib/tools/cards/actions");
const { GET } = await import("./route");
const { POST } = await import("./[id]/route");

const signedIn = () => vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
const press = (body: unknown, id = "card-1", headers: Record<string, string> = {}) =>
  POST(new Request(`http://x/api/tool-cards/${id}`, { method: "POST", body: JSON.stringify(body), headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "dueno", duenoId: "u1" } as never);
  vi.mocked(cardsOfProject).mockResolvedValue([{ id: "card-1", phase: "proposed" }] as never);
  vi.mocked(actOnCard).mockResolvedValue({ status: "accepted" });
});

describe("GET /api/tool-cards?projectId=", () => {
  it("the session person's cards in that project", async () => {
    const res = await GET(new Request("http://x/api/tool-cards?projectId=p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [{ id: "card-1", phase: "proposed" }], capCredits: 25 });
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "u1", "ver");
    expect(cardsOfProject).toHaveBeenCalledWith("p1", "u1");
  });

  it("no session: 401; no projectId: 400; no access: its answer", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(null);
    expect((await GET(new Request("http://x/api/tool-cards?projectId=p1"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/tool-cards"))).status).toBe(400);
    vi.mocked(exigirAcceso).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("http://x/api/tool-cards?projectId=p9"))).status).toBe(404);
  });

  it("a phone key alone is refused", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/tool-cards?projectId=p1", { headers: { authorization: "Bearer phone-key" } }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/tool-cards/[id]", () => {
  it("a press goes to the card's action as the session person, with the place and the person's language and zone", async () => {
    const res = await press({ verb: "create", payload: { placement: "project" }, locale: "es", timeZone: "Europe/Madrid" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
    expect(actOnCard).toHaveBeenCalledWith("card-1", "u1", "create", { placement: "project", locale: "es", timeZone: "Europe/Madrid" }, expect.anything());
  });

  it("settled: 200 with the card", async () => {
    vi.mocked(actOnCard).mockResolvedValueOnce({ status: "settled", card: { id: "card-1", phase: "dismissed" } as never });
    const res = await press({ verb: "dismiss" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "settled", card: { id: "card-1", phase: "dismissed" } });
  });

  it("refused: plan_required → 402, unknown → 404, anything else → 409 with the reason", async () => {
    vi.mocked(actOnCard).mockResolvedValueOnce({ status: "refused", reason: "plan_required" });
    expect((await press({ verb: "create" })).status).toBe(402);
    vi.mocked(actOnCard).mockResolvedValueOnce({ status: "refused", reason: "unknown" });
    expect((await press({ verb: "create" }, "card-of-someone-else")).status).toBe(404);
    vi.mocked(actOnCard).mockResolvedValueOnce({ status: "refused", reason: "source-missing" });
    const r = await press({ verb: "restore" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ status: "refused", reason: "source-missing" });
  });

  it("an unknown verb: 400, nothing acted on", async () => {
    expect((await press({ verb: "explode" })).status).toBe(400);
    expect(actOnCard).not.toHaveBeenCalled();
  });

  it("no session: 401, even with a phone key", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(null);
    expect((await press({ verb: "create" }, "card-1", { authorization: "Bearer phone-key" })).status).toBe(401);
    expect(actOnCard).not.toHaveBeenCalled();
  });
});
