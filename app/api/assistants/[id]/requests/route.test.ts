// @vitest-environment node
//
// WHAT VISITORS ASKED FOR, for her person only (spec local 2026-11-06-asistente-propio, §4.3.3, §4.6.1, §4.6.2, §6.12):
// her «Pedidos», the press on a card, and the project's cards for Len's chat — none of it for a member or for another
// person, and nothing at all with OPENLEN_ASSISTANT=0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id: string } } | null> => ({ user: { id: "u1" } })),
  assistantById: vi.fn(async (): Promise<unknown> => null),
  requestCardsOfAssistant: vi.fn(async (): Promise<unknown[]> => []),
  requestCardsOfProject: vi.fn(async (): Promise<unknown[]> => []),
  pressRequestCard: vi.fn(async (): Promise<unknown> => ({ ok: true, status: "dismissed" })),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: m.assistantById }));
vi.mock("@/lib/assistants/requests/store", () => ({ requestCardsOfAssistant: m.requestCardsOfAssistant, requestCardsOfProject: m.requestCardsOfProject }));
vi.mock("@/lib/assistants/requests/press", () => ({ pressRequestCard: m.pressRequestCard }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));

const { fijarAccesoDePrueba } = await import("@/lib/projects/acceso-de-prueba");
const list = await import("./route");
const one = await import("./[cardId]/route");
const project = await import("@/app/api/projects/[id]/assistant-requests/route");

const AT = new Date("2026-11-09T12:00:00Z");
const LUCIA = { id: "a1", personId: "u1", name: "Lucía", slug: "lucia" };
const CARD = { id: "c1", assistantId: "a1", projectId: "p1", title: "Envíos a domicilio", locale: "es", status: "pending", visitors: 5, createdAt: AT, lastAt: AT, decidedAt: null, decidedBy: "u1", acceptedRowId: null, failure: null };
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const post = (body: unknown, cardId = "c1", id = "a1") =>
  one.POST(new Request(`http://localhost/api/assistants/${id}/requests/${cardId}`, { method: "POST", body: JSON.stringify(body) }), params({ id, cardId }));

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.assistantById.mockResolvedValue(LUCIA);
  fijarAccesoDePrueba(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/assistants/[id]/requests", () => {
  it("her cards, for her person", async () => {
    m.requestCardsOfAssistant.mockResolvedValueOnce([{ ...CARD, projectTitle: "Pastelería" }]);
    const res = await list.GET(new Request("http://localhost/api/assistants/a1/requests"), params({ id: "a1" }));
    expect(res.status).toBe(200);
    const { cards } = (await res.json()) as { cards: Record<string, unknown>[] };
    expect(cards).toEqual([{ id: "c1", projectId: "p1", projectTitle: "Pastelería", title: "Envíos a domicilio", visitors: 5, status: "pending", failure: null, acceptedRowId: null, createdAt: AT.toISOString(), lastAt: AT.toISOString(), decidedAt: null }]);
  });

  it("🔴 another person's assistant is 404", async () => {
    m.assistantById.mockResolvedValue({ ...LUCIA, personId: "u2" });
    expect((await list.GET(new Request("http://localhost/x"), params({ id: "a1" }))).status).toBe(404);
    expect((await post({ action: "accept" })).status).toBe(404);
    expect(m.requestCardsOfAssistant).not.toHaveBeenCalled();
    expect(m.pressRequestCard).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    m.auth.mockResolvedValue(null);
    expect((await list.GET(new Request("http://localhost/x"), params({ id: "a1" }))).status).toBe(401);
    expect((await post({ action: "accept" })).status).toBe(401);
  });

  it("OPENLEN_ASSISTANT=0 is 404", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await list.GET(new Request("http://localhost/x"), params({ id: "a1" }))).status).toBe(404);
    expect((await post({ action: "accept" })).status).toBe(404);
    expect((await project.GET(new Request("http://localhost/x"), params({ id: "p1" }))).status).toBe(404);
  });
});

describe("POST /api/assistants/[id]/requests/[cardId]", () => {
  it("«Que Len lo haga»: 202 with the turn's row, text and project, so the chat can follow it", async () => {
    m.pressRequestCard.mockResolvedValueOnce({ ok: true, status: "accepted", rowId: "row-1", text: "💬 De Lucía: Envíos", origin: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" }, projectId: "p1" });
    const res = await post({ action: "accept", timeZone: "America/Mexico_City" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted", rowId: "row-1", text: "💬 De Lucía: Envíos", origin: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" }, projectId: "p1" });
    expect(m.pressRequestCard).toHaveBeenCalledWith({ assistant: { id: "a1", name: "Lucía" }, cardId: "c1", action: "accept", actorId: "u1", timeZone: "America/Mexico_City" });
  });

  it("«Ahora no»: 200; an unknown time zone is left out", async () => {
    const res = await post({ action: "dismiss", timeZone: "Mars/Olympus" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "dismissed" });
    expect(m.pressRequestCard).toHaveBeenCalledWith({ assistant: { id: "a1", name: "Lucía" }, cardId: "c1", action: "dismiss", actorId: "u1" });
  });

  it("decided already: 409; a bad action: 400", async () => {
    m.pressRequestCard.mockResolvedValueOnce({ ok: false, reason: "not_pending" });
    const res = await post({ action: "accept" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_pending" });
    expect((await post({ action: "delete" })).status).toBe(400);
  });
});

describe("GET /api/projects/[id]/assistant-requests", () => {
  const get = () => project.GET(new Request("http://localhost/api/projects/p1/assistant-requests"), params({ id: "p1" }));

  it("the owner's cards, each with whose assistant it is", async () => {
    m.requestCardsOfProject.mockResolvedValueOnce([{ ...CARD, assistantName: "Lucía", personId: "u1" }, { ...CARD, id: "c2", assistantId: "a9", assistantName: "Otra", personId: "u2" }]);
    const res = await get();
    expect(res.status).toBe(200);
    const { cards } = (await res.json()) as { cards: { id: string; assistantId: string; assistantName: string }[] };
    // Only her person's: another person's assistant's card never shows, even in this project.
    expect(cards.map((c) => [c.id, c.assistantId, c.assistantName])).toEqual([["c1", "a1", "Lucía"]]);
  });

  it("a member gets no cards", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "u9" }));
    m.requestCardsOfProject.mockResolvedValueOnce([{ ...CARD, assistantName: "Lucía", personId: "u9" }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [] });
    expect(m.requestCardsOfProject).not.toHaveBeenCalled();
  });

  it("someone with no access gets the access error", async () => {
    fijarAccesoDePrueba(() => null);
    expect((await get()).status).toBeGreaterThanOrEqual(400);
  });
});
