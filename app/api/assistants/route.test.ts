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
  switchOldAssistantOff: vi.fn(async () => true),
  // Her visitors (phase 2A).
  setOnPage: vi.fn(async () => true),
  visitsOf: vi.fn(async (): Promise<unknown[]> => []),
  // Phase 4: which of her projects each visit came from.
  titlesOf: vi.fn(async (): Promise<Map<string, string | null>> => new Map([["p1", "Pastelería Canela"]])),
  monthSpent: vi.fn(async () => 0),
  explicitVisitorCap: vi.fn(async (): Promise<number | null> => null),
  setExplicitVisitorCap: vi.fn(async () => {}),
  creditState: vi.fn(async () => ({ plan: "pro", balance: 10_000, allotment: 50_000, refillsAt: null })),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/assistants/store", () => ({ createAssistant: m.createAssistant, assistantsOf: m.assistantsOf, assistantById: m.assistantById, deleteAssistant: m.deleteAssistant, oldAssistantSettings: m.oldAssistantSettings, switchOldAssistantOff: m.switchOldAssistantOff }));
vi.mock("@/lib/assistants/projects", () => ({ titlesOf: m.titlesOf }));
vi.mock("@/lib/assistants/visitor/store", () => ({ setOnPage: m.setOnPage, visitsOf: m.visitsOf, monthSpent: m.monthSpent, explicitVisitorCap: m.explicitVisitorCap, setExplicitVisitorCap: m.setExplicitVisitorCap }));
vi.mock("@/lib/credits", () => ({ getCreditState: m.creditState }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));

const { fijarAccesoDePrueba } = await import("@/lib/projects/acceso-de-prueba");
const { GET, POST } = await import("./route");
const one = await import("./[id]/route");
const visits = await import("./[id]/visits/route");
const budget = await import("./visitor-budget/route");

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

// HER PLACE'S CONTROLS (spec local 2026-11-06-asistente-propio, §4.4.5, §4.7, §6.2, §6.5; phase 2A).
describe("her place's controls", () => {
  const patch = (id: string, body: unknown) => one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), params(id));

  // Phase 2B: an app's public data is something for her to know.
  it("an app can turn her on now", async () => {
    m.assistantById.mockResolvedValue(LUCIA);
    const res = await patch("a1", { onPage: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onPage: true, needsPublish: true });
    expect(m.setOnPage).toHaveBeenCalledWith("p1", "a1", true);
  });

  it("🔴 only its person turns her on the page; the old assistant stays until the publish that brings her", async () => {
    m.assistantById.mockResolvedValue(LUCIA);
    const res = await patch("a1", { onPage: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onPage: true, needsPublish: true });
    expect(m.setOnPage).toHaveBeenCalledWith("p1", "a1", true);
    expect(m.switchOldAssistantOff).not.toHaveBeenCalled();

    vi.clearAllMocks();
    m.assistantById.mockResolvedValue(LUCIA);
    expect(await (await patch("a1", { onPage: false })).json()).toEqual({ onPage: false, needsPublish: false });
    expect(m.switchOldAssistantOff).not.toHaveBeenCalled();

    m.assistantById.mockResolvedValue({ ...LUCIA, personId: "u2" });
    expect((await patch("a1", { onPage: true })).status).toBe(404);
    expect((await patch("a1", { onPage: "sí" })).status).toBe(400);
  });

  it("visits are only its person's — a project member gets a 404", async () => {
    const at = new Date("2026-11-07T18:00:00Z");
    m.assistantById.mockResolvedValue(LUCIA);
    m.visitsOf.mockResolvedValue([
      { id: "v1", assistantId: "a1", projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", startedAt: at, lastAt: at, messageCount: 2, centicredits: 9, handedOff: true, transcript: [{ role: "user", content: "secreto" }], lines: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "visitor", text: `l${i}`, at: at.toISOString() })) },
    ]);
    const res = await visits.GET(new Request("http://x"), params("a1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visits: { id: string; lines: { text: string }[]; transcript?: unknown; visitorId?: unknown }[] };
    expect(body.visits[0]).toMatchObject({ id: "v1", messageCount: 2, handedOff: true, projectId: "p1", projectTitle: "Pastelería Canela" });
    expect(body.visits[0]!.lines).toHaveLength(40);
    expect(body.visits[0]!.lines.at(-1)!.text).toBe("l49");
    expect(body.visits[0]!.transcript).toBeUndefined();
    expect(body.visits[0]!.visitorId).toBeUndefined();
    expect(m.visitsOf).toHaveBeenCalledWith("a1", 50);

    m.auth.mockResolvedValue({ user: { id: "u2" } });
    expect((await visits.GET(new Request("http://x"), params("a1"))).status).toBe(404);
  });

  it("the budget can't go above the plan; null goes back to the default", async () => {
    m.monthSpent.mockResolvedValue(1_200);
    const got = await budget.GET();
    expect(await got.json()).toEqual({ spent: 1_200, cap: 12_500, explicit: null, max: 50_000 });
    const put = (b: unknown) => budget.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(b) }));
    expect((await put({ cap: 2_000 })).status).toBe(200);
    expect(m.setExplicitVisitorCap).toHaveBeenLastCalledWith("u1", 2_000);
    expect((await put({ cap: 60_000 })).status).toBe(400);
    expect((await put({ cap: -1 })).status).toBe(400);
    expect((await put({ cap: null })).status).toBe(200);
    expect(m.setExplicitVisitorCap).toHaveBeenLastCalledWith("u1", null);
  });

  it("with OPENLEN_ASSISTANT=0 every new route is 404 assistants_off", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    m.assistantById.mockResolvedValue(LUCIA);
    for (const res of [await patch("a1", { onPage: true }), await visits.GET(new Request("http://x"), params("a1")), await budget.GET()]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "assistants_off" });
    }
    expect(m.setOnPage).not.toHaveBeenCalled();
  });
});
