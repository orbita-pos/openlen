// @vitest-environment node
//
// HER ROUTES TAKE THE PHONE'S KEY (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): what her tab in Len móvil
// reads — her list, her chat with her owner, her visitors' conversations and her requests — and the press on a request,
// with «Authorization: Bearer <key>» as the phone sends it (lib/movil/quien.ts). Still only her person's.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id: string } } | null> => null),
  usuarioDeLaLlave: vi.fn(async (k: string): Promise<string | null> => ({ [KEY_U1]: "u1", [KEY_U2]: "u2" })[k] ?? null),
  assistantsOf: vi.fn(async (): Promise<unknown[]> => [LUCIA]),
  assistantById: vi.fn(async (): Promise<unknown> => LUCIA),
  projectIdsOf: vi.fn(async (): Promise<Map<string, string[]>> => new Map([["a1", ["p1"]]])),
  titlesOf: vi.fn(async (): Promise<Map<string, string | null>> => new Map([["p1", "Pastelería Canela"]])),
  visitsOf: vi.fn(async (): Promise<unknown[]> => []),
  requestCardsOfAssistant: vi.fn(async (): Promise<unknown[]> => []),
  pressRequestCard: vi.fn(async (): Promise<unknown> => ({ ok: true, status: "dismissed" })),
  getChatMessages: vi.fn(async (): Promise<unknown[]> => [{ id: "t1", role: "user", text: "hola" }]),
}));
const KEY_U1 = "llave-de-u1-aaaaaaaaaaaaaaaaaaaa";
const KEY_U2 = "llave-de-u2-bbbbbbbbbbbbbbbbbbbb";
const LUCIA = { id: "a1", personId: "u1", name: "Lucía", slug: "lucia", shape: "blob", color: "#F4A48B", tone: "friendly", homeProjectId: "p1", memory: "secreto", morningSummary: false };

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: m.usuarioDeLaLlave }));
vi.mock("@/lib/assistants/store", () => ({ assistantsOf: m.assistantsOf, assistantById: m.assistantById, createAssistant: vi.fn(), oldAssistantSettings: vi.fn() }));
vi.mock("@/lib/assistants/projects", () => ({ projectIdsOf: m.projectIdsOf, titlesOf: m.titlesOf }));
vi.mock("@/lib/assistants/visitor/store", () => ({ visitsOf: m.visitsOf }));
vi.mock("@/lib/assistants/requests/store", () => ({ requestCardsOfAssistant: m.requestCardsOfAssistant }));
vi.mock("@/lib/assistants/requests/press", () => ({ pressRequestCard: m.pressRequestCard }));
vi.mock("@/lib/projects/chat", () => ({ getChatMessages: m.getChatMessages }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));

const list = await import("./route");
const chat = await import("./[id]/chat/route");
const visits = await import("./[id]/visits/route");
const requests = await import("./[id]/requests/route");
const press = await import("./[id]/requests/[cardId]/route");

const withKey = (key: string, url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${key}` } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => vi.clearAllMocks());

describe("her routes with the phone's key", () => {
  it("🔴 the phone's key lists her, as the person", async () => {
    const res = await list.GET(withKey(KEY_U1, "http://x/api/assistants"));
    expect(res.status).toBe(200);
    expect((await res.json()).assistants.map((a: { id: string }) => a.id)).toEqual(["a1"]);
    expect(m.assistantsOf).toHaveBeenCalledWith("u1");
  });

  it("🔴 her chat: the first page of her conversation with her owner, as her place loads it", async () => {
    const res = await chat.GET(withKey(KEY_U1, "http://x/api/assistants/a1/chat"), params({ id: "a1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chatHistory: [{ id: "t1", role: "user", text: "hola" }] });
    expect(m.getChatMessages).toHaveBeenCalledWith("p1", { charla: "assistant:a1" });
  });

  it("🔴 her visits and her requests reach the phone", async () => {
    expect((await visits.GET(withKey(KEY_U1, "http://x/api/assistants/a1/visits"), params({ id: "a1" }))).status).toBe(200);
    expect((await requests.GET(withKey(KEY_U1, "http://x/api/assistants/a1/requests"), params({ id: "a1" }))).status).toBe(200);
  });

  it("🔴 pressing a request with the phone's key presses it as the person", async () => {
    const res = await press.POST(withKey(KEY_U1, "http://x/api/assistants/a1/requests/c1", { method: "POST", body: JSON.stringify({ action: "dismiss" }) }), params({ id: "a1", cardId: "c1" }));
    expect(res.status).toBe(200);
    expect(m.pressRequestCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: "c1", action: "dismiss", actorId: "u1" }));
  });

  it("🔴 another person's key gets 404 on her, and a bad key 401", async () => {
    expect((await chat.GET(withKey(KEY_U2, "http://x/api/assistants/a1/chat"), params({ id: "a1" }))).status).toBe(404);
    expect((await visits.GET(withKey(KEY_U2, "http://x/api/assistants/a1/visits"), params({ id: "a1" }))).status).toBe(404);
    expect((await requests.GET(withKey(KEY_U2, "http://x/api/assistants/a1/requests"), params({ id: "a1" }))).status).toBe(404);
    expect((await press.POST(withKey(KEY_U2, "http://x/api/assistants/a1/requests/c1", { method: "POST", body: JSON.stringify({ action: "dismiss" }) }), params({ id: "a1", cardId: "c1" }))).status).toBe(404);
    expect(m.pressRequestCard).not.toHaveBeenCalled();
    expect((await chat.GET(withKey("llave-que-no-existe-cccccccc", "http://x/api/assistants/a1/chat"), params({ id: "a1" }))).status).toBe(401);
  });

  it("every one answers the phone's preflight", () => {
    for (const r of [list, chat, visits, requests, press]) expect(typeof r.OPTIONS).toBe("function");
  });
});
