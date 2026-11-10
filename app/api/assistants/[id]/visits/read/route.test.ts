// @vitest-environment node
//
// HER OWNER SAW HER CONVERSATIONS (spec local 2026-11-06-asistente-propio, §6.5; plan …-fase-4e, task 3): her
// Conversaciones, on the web or the phone, marks the conversations it showed as read — as the page's inbox does — so
// `list_messages` in her chat counts only what came after. Her person only, with the session or the phone's key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id: string } } | null> => ({ user: { id: "u1" } })),
  usuarioDeLaLlave: vi.fn(async (k: string): Promise<string | null> => (k === "llave-de-u1-aaaaaaaaaaaaaaaaaaaa" ? "u1" : null)),
  assistantById: vi.fn(async (): Promise<unknown> => ({ id: "a1", personId: "u1", name: "Lucía", slug: "lucia" })),
  markHerVisitsRead: vi.fn(async (_a: string, ids: readonly string[]): Promise<number> => ids.length),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: m.usuarioDeLaLlave }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: m.assistantById }));
vi.mock("@/lib/assistants/visitor/inbox", () => ({ markHerVisitsRead: m.markHerVisitsRead }));

const route = await import("./route");

const params = (id = "a1") => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = {}, id = "a1") =>
  route.POST(new Request(`http://localhost/api/assistants/${id}/visits/read`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), params(id));

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.assistantById.mockResolvedValue({ id: "a1", personId: "u1", name: "Lucía", slug: "lucia" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/assistants/[id]/visits/read", () => {
  it("marks her visits read for her person, with the session or the phone key", async () => {
    const res = await post({ ids: ["v1", "v2"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 2 });
    expect(m.markHerVisitsRead).toHaveBeenCalledWith("a1", ["v1", "v2"], expect.any(Date));
    m.auth.mockResolvedValue(null);
    const byKey = await post({ ids: ["v1"] }, { authorization: "Bearer llave-de-u1-aaaaaaaaaaaaaaaaaaaa" });
    expect(byKey.status).toBe(200);
    expect(await byKey.json()).toEqual({ marked: 1 });
  });

  it("🔴 404 for someone else's assistant, nothing marked", async () => {
    m.assistantById.mockResolvedValue({ id: "a1", personId: "u2", name: "Bruno", slug: "bruno" });
    expect((await post({ ids: ["v1"] })).status).toBe(404);
    m.assistantById.mockResolvedValue(null);
    expect((await post({ ids: ["v1"] })).status).toBe(404);
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    m.assistantById.mockResolvedValue({ id: "a1", personId: "u1", name: "Lucía", slug: "lucia" });
    expect((await post({ ids: ["v1"] })).status).toBe(404);
    expect(m.markHerVisitsRead).not.toHaveBeenCalled();
  });

  it("400 for a body without ids", async () => {
    for (const body of [{}, { ids: [] }, { ids: [1] }, { ids: "v1" }, { ids: Array.from({ length: 51 }, (_, i) => `v${i}`) }, "no es json"]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(m.markHerVisitsRead).not.toHaveBeenCalled();
  });

  it("401 without a person", async () => {
    m.auth.mockResolvedValue(null);
    expect((await post({ ids: ["v1"] })).status).toBe(401);
  });
});
