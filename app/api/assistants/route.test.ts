// @vitest-environment node
//
// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.4): the creator's «Listo» creates it; the
// person's place lists theirs; only its person deletes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id: string } } | null> => ({ user: { id: "u1" } })),
  createAssistant: vi.fn(),
  assistantsOf: vi.fn(async (): Promise<unknown[]> => []),
  assistantById: vi.fn(async (): Promise<unknown> => null),
  deleteAssistant: vi.fn(async () => true),
  oldAssistantSettings: vi.fn(async (): Promise<unknown> => undefined),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/assistants/store", () => ({ createAssistant: m.createAssistant, assistantsOf: m.assistantsOf, assistantById: m.assistantById, deleteAssistant: m.deleteAssistant, oldAssistantSettings: m.oldAssistantSettings }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));

const { fijarAccesoDePrueba } = await import("@/lib/projects/acceso-de-prueba");
const { GET, POST } = await import("./route");
const one = await import("./[id]/route");

const LUCIA = { id: "a1", personId: "u1", name: "Lucía", slug: "lucia", shape: "blob", color: "#F4A48B", tone: "friendly", memory: "secreto", homeProjectId: "p1", createdAt: new Date(0), updatedAt: new Date(0) };
const BODY = { projectId: "p1", name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" };
const post = (body: unknown) => POST(new Request("http://localhost/api/assistants", { method: "POST", body: JSON.stringify(body) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.createAssistant.mockResolvedValue({ ok: true, assistant: LUCIA });
  fijarAccesoDePrueba(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/assistants", () => {
  it("creates it for the project's owner", async () => {
    const res = await post(BODY);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "a1", slug: "lucia" });
    expect(m.createAssistant).toHaveBeenCalledWith({ personId: "u1", projectId: "p1", input: { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" }, memory: "" });
  });

  it("🔴 creating her in a project whose old assistant had facts starts her memory with them", async () => {
    m.oldAssistantSettings.mockResolvedValueOnce({ enabled: true, facts: "Envíos sólo en Guadalajara." });
    expect((await post(BODY)).status).toBe(201);
    const [arg] = m.createAssistant.mock.calls[0] as unknown as [{ memory: string }];
    expect(arg.memory).toContain("Envíos sólo en Guadalajara.");
    expect(m.oldAssistantSettings).toHaveBeenCalledWith("p1");
  });

  it("refuses an editor of the project", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "u9" }));
    expect((await post(BODY)).status).toBe(403);
    expect(m.createAssistant).not.toHaveBeenCalled();
  });

  it("says which field is wrong", async () => {
    const res = await post({ ...BODY, name: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ field: "name" });
  });

  it("409 when the name is taken or the project has one", async () => {
    m.createAssistant.mockResolvedValueOnce({ ok: false, code: "name_taken" });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "name_taken" });
  });

  it("401 without a session, 404 when assistants are off", async () => {
    m.auth.mockResolvedValueOnce(null);
    expect((await post(BODY)).status).toBe(401);
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    const res = await post(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "assistants_off" });
  });
});

describe("GET /api/assistants", () => {
  it("lists the person's own, without their memory", async () => {
    m.assistantsOf.mockResolvedValueOnce([LUCIA]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", shape: "blob", color: "#F4A48B", tone: "friendly", projectId: "p1" }] });
    expect(m.assistantsOf).toHaveBeenCalledWith("u1");
  });
});

describe("/api/assistants/[id]", () => {
  it("GET gives the person's own and 404s someone else's", async () => {
    m.assistantById.mockResolvedValueOnce(LUCIA);
    expect(await (await one.GET(new Request("http://x"), params("a1"))).json()).toMatchObject({ id: "a1", name: "Lucía" });
    m.assistantById.mockResolvedValueOnce({ ...LUCIA, personId: "u2" });
    expect((await one.GET(new Request("http://x"), params("a1"))).status).toBe(404);
  });

  it("DELETE removes only the person's own", async () => {
    expect((await one.DELETE(new Request("http://x", { method: "DELETE" }), params("a1"))).status).toBe(204);
    expect(m.deleteAssistant).toHaveBeenCalledWith("u1", "a1");
    m.deleteAssistant.mockResolvedValueOnce(false);
    expect((await one.DELETE(new Request("http://x", { method: "DELETE" }), params("a2"))).status).toBe(404);
  });

  it("🔴 with assistants off, GET and DELETE answer assistants_off and touch nothing", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    m.assistantById.mockResolvedValue(LUCIA);
    const got = await one.GET(new Request("http://x"), params("a1"));
    expect(got.status).toBe(404);
    expect(await got.json()).toEqual({ error: "assistants_off" });
    const gone = await one.DELETE(new Request("http://x", { method: "DELETE" }), params("a1"));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "assistants_off" });
    expect(m.assistantById).not.toHaveBeenCalled();
    expect(m.deleteAssistant).not.toHaveBeenCalled();
  });
});
