// @vitest-environment node
//
// THE «CREAR» CARD'S ROUTES (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the person's cards in a
// project, and a press on one. The workspace's session or, since phase 5 (§4.14), the phone app's key.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: vi.fn(async (k: string) => (k === "phone-key-0123456789abcdef" ? "u1" : null)) }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/tools/cards/store", () => ({ cardsOfProject: vi.fn(), toCardView: (r: { id: string; phase: string }) => ({ id: r.id, phase: r.phase }) }));
vi.mock("@/lib/tools/cards/actions", () => ({ actOnCard: vi.fn(), realActionDeps: vi.fn(async () => ({})), reconcileOnRead: vi.fn(async (rows: unknown[]) => rows) }));
vi.mock("@/lib/tools/suggestions", () => ({ toolSuggestionsEnabled: vi.fn(() => true) }));

const { auth } = await import("@/auth");
const { exigirAcceso } = await import("@/lib/projects/acceso");
const { cardsOfProject } = await import("@/lib/tools/cards/store");
const { actOnCard, reconcileOnRead } = await import("@/lib/tools/cards/actions");
const { toolSuggestionsEnabled } = await import("@/lib/tools/suggestions");
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

  it("🔴 the cards are reconciled when read: one left «creando» by a restart comes back «interrumpida»", async () => {
    vi.mocked(reconcileOnRead).mockResolvedValueOnce([{ id: "card-1", phase: "interrupted" }] as never);
    const res = await GET(new Request("http://x/api/tool-cards?projectId=p1"));
    expect(((await res.json()) as { cards: unknown }).cards).toEqual([{ id: "card-1", phase: "interrupted" }]);
    expect(reconcileOnRead).toHaveBeenCalledWith([{ id: "card-1", phase: "proposed" }]);
  });

  it("🔴 the switches off (OPENLEN_TOOLS=0 or OPENLEN_TOOL_SUGGESTIONS=0): 404, for reading and for pressing", async () => {
    vi.mocked(toolSuggestionsEnabled).mockReturnValue(false);
    expect((await GET(new Request("http://x/api/tool-cards?projectId=p1"))).status).toBe(404);
    expect((await press({ verb: "create" })).status).toBe(404);
    expect(actOnCard).not.toHaveBeenCalled();
    vi.mocked(toolSuggestionsEnabled).mockReturnValue(true);
  });

  it("no session: 401; no projectId: 400; no access: its answer", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(null);
    expect((await GET(new Request("http://x/api/tool-cards?projectId=p1"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/tool-cards"))).status).toBe(400);
    vi.mocked(exigirAcceso).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("http://x/api/tool-cards?projectId=p9"))).status).toBe(404);
  });

  it("with the phone's key, that person's cards, with the app's CORS (phase 5)", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/tool-cards?projectId=p1", { headers: { authorization: "Bearer phone-key-0123456789abcdef", origin: "https://localhost" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(cardsOfProject).toHaveBeenCalledWith("p1", "u1");
  });

  it("a key that doesn't resolve: 401, whatever session is around", async () => {
    const res = await GET(new Request("http://x/api/tool-cards?projectId=p1", { headers: { authorization: "Bearer not-a-key-0123456789abcdef" } }));
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

  it("with the phone's key, the press acts as that person (phase 5); a key that doesn't resolve is 401", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await press({ verb: "create" }, "card-1", { authorization: "Bearer phone-key-0123456789abcdef" })).status).toBe(202);
    expect(actOnCard).toHaveBeenCalledWith("card-1", "u1", "create", expect.anything(), expect.anything());
    vi.mocked(actOnCard).mockClear();
    expect((await press({ verb: "create" }, "card-1", { authorization: "Bearer not-a-key-0123456789abcdef" })).status).toBe(401);
    expect(actOnCard).not.toHaveBeenCalled();
  });
});
