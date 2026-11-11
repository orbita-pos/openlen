// @vitest-environment node
//
// HER PROJECTS (spec local 2026-11-06-asistente-propio, §4.5, §6.4, §6.12): her person connects her to one of their own
// projects, takes her off one (never her last), and turns her bubble on per project. A member or another person gets
// nothing; with OPENLEN_ASSISTANT=0 nothing answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user?: { id: string } } | null> => ({ user: { id: "u1" } })),
  assistantById: vi.fn(async (): Promise<unknown> => null),
  oldAssistantSettings: vi.fn(async (): Promise<unknown> => undefined),
  saveAssistantMemory: vi.fn(async () => {}),
  projectsOfAssistant: vi.fn(async (): Promise<unknown[]> => []),
  connectProject: vi.fn(async (): Promise<string> => "connected"),
  disconnectProject: vi.fn(async (): Promise<string> => "disconnected"),
  titlesOf: vi.fn(async (): Promise<Map<string, string | null>> => new Map([["p2", "Canela Tienda"]])),
  setOnPage: vi.fn(async () => true),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: m.assistantById, oldAssistantSettings: m.oldAssistantSettings, saveAssistantMemory: m.saveAssistantMemory }));
vi.mock("@/lib/assistants/projects", () => ({ projectsOfAssistant: m.projectsOfAssistant, connectProject: m.connectProject, disconnectProject: m.disconnectProject, titlesOf: m.titlesOf }));
vi.mock("@/lib/assistants/visitor/store", () => ({ setOnPage: m.setOnPage }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));

const { fijarAccesoDePrueba } = await import("@/lib/projects/acceso-de-prueba");
const list = await import("./route");
const one = await import("./[projectId]/route");

const AT = new Date("2026-11-09T12:00:00Z");
const LUCIA = { id: "a1", personId: "u1", name: "Lucía", slug: "lucia", memory: "Envíos sólo en Guadalajara.", homeProjectId: "p1" };
const served = (over: Record<string, unknown> = {}) => ({
  projectId: "p1",
  title: "Pastelería Canela",
  subdomain: "canela",
  isHome: true,
  onPage: true,
  knowledge: "Martes a domingo.",
  knowledgeAt: AT,
  bakedAt: AT,
  publicData: [],
  connectedAt: AT,
  ...over,
});
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const post = (body: unknown, id = "a1") => list.POST(new Request(`http://localhost/api/assistants/${id}/projects`, { method: "POST", body: JSON.stringify(body) }), params({ id }));
const del = (projectId: string, id = "a1") => one.DELETE(new Request("http://x", { method: "DELETE" }), params({ id, projectId }));
const patch = (projectId: string, body: unknown, id = "a1") => one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), params({ id, projectId }));

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1" } });
  m.assistantById.mockResolvedValue(LUCIA);
  fijarAccesoDePrueba(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/assistants/[id]/projects", () => {
  it("her projects, home first, with their address and what «En mi página» says", async () => {
    m.projectsOfAssistant.mockResolvedValueOnce([served(), served({ projectId: "p2", title: "Canela Tienda", subdomain: null, isHome: false, onPage: true, bakedAt: null })]);
    const res = await list.GET(new Request("http://x"), params({ id: "a1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      projects: [
        { projectId: "p1", title: "Pastelería Canela", address: "canela.openlen.app", isHome: true, onPage: true, needsPublish: false, nothingToKnow: false, knowsIt: true },
        { projectId: "p2", title: "Canela Tienda", address: null, isHome: false, onPage: true, needsPublish: true, nothingToKnow: false, knowsIt: true },
      ],
    });
  });
});

describe("POST /api/assistants/[id]/projects", () => {
  it("connects one of the person's own projects", async () => {
    const res = await post({ projectId: "p2" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ projectId: "p2" });
    expect(m.connectProject).toHaveBeenCalledWith({ assistantId: "a1", projectId: "p2" });
  });

  it("🔴 a project where the person is a member is 403, another person's is 404", async () => {
    fijarAccesoDePrueba(() => ({ rol: "editor", duenoId: "u9" }));
    expect((await post({ projectId: "p2" })).status).toBe(403);
    fijarAccesoDePrueba(() => null);
    expect((await post({ projectId: "p2" })).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect(m.connectProject).not.toHaveBeenCalled();
  });

  it("409 when the project already has an assistant", async () => {
    m.connectProject.mockResolvedValueOnce("project_has_assistant");
    const res = await post({ projectId: "p2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_has_assistant" });
    expect(m.saveAssistantMemory).not.toHaveBeenCalled();
  });

  it("connecting brings that project's old assistant into her memory, within its cap", async () => {
    m.oldAssistantSettings.mockResolvedValueOnce({ enabled: true, facts: "En la tienda, envíos los viernes." });
    expect((await post({ projectId: "p2" })).status).toBe(201);
    expect(m.oldAssistantSettings).toHaveBeenCalledWith("p2");
    const [id, memory] = m.saveAssistantMemory.mock.calls[0] as unknown as [string, string];
    expect(id).toBe("a1");
    expect(memory.startsWith("Envíos sólo en Guadalajara.")).toBe(true);
    expect(memory).toContain("Canela Tienda");
    expect(memory).toContain("En la tienda, envíos los viernes.");
    // Nothing to bring: her memory is left alone.
    m.saveAssistantMemory.mockClear();
    expect((await post({ projectId: "p3" })).status).toBe(201);
    expect(m.saveAssistantMemory).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/assistants/[id]/projects/[projectId]", () => {
  it("takes her off a project", async () => {
    expect((await del("p2")).status).toBe(204);
    expect(m.disconnectProject).toHaveBeenCalledWith("a1", "p2");
  });

  it("🔴 published before she served it: the row says she doesn't know it yet", async () => {
    m.projectsOfAssistant.mockResolvedValueOnce([served({ projectId: "p2", isHome: false, knowledge: null, knowledgeAt: null, bakedAt: null, onPage: false })]);
    const { projects } = (await (await list.GET(new Request("http://x"), params({ id: "a1" }))).json()) as { projects: { knowsIt: boolean }[] };
    expect(projects[0]!.knowsIt).toBe(false);
  });

  it("🔴 while she is answering, her home can't be removed: 409 busy", async () => {
    m.disconnectProject.mockResolvedValueOnce("busy");
    const res = await del("p1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy" });
  });

  it("her only project can't be removed: 409 only_project; one she doesn't serve is 404", async () => {
    m.disconnectProject.mockResolvedValueOnce("only_project");
    const res = await del("p1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "only_project" });
    m.disconnectProject.mockResolvedValueOnce("not_connected");
    expect((await del("p9")).status).toBe(404);
  });
});

describe("PATCH /api/assistants/[id]/projects/[projectId]", () => {
  it("«En mi página» is per project; one she doesn't serve is 404", async () => {
    const res = await patch("p2", { onPage: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onPage: true, needsPublish: true });
    expect(m.setOnPage).toHaveBeenCalledWith("p2", "a1", true);
    m.setOnPage.mockResolvedValueOnce(false);
    expect((await patch("p9", { onPage: false })).status).toBe(404);
    expect((await patch("p2", { onPage: "yes" })).status).toBe(400);
  });
});

describe("only her person", () => {
  it("🔴 another person's assistant is 404 on every route", async () => {
    m.assistantById.mockResolvedValue({ ...LUCIA, personId: "u2" });
    expect((await list.GET(new Request("http://x"), params({ id: "a1" }))).status).toBe(404);
    expect((await post({ projectId: "p2" })).status).toBe(404);
    expect((await del("p2")).status).toBe(404);
    expect((await patch("p2", { onPage: true })).status).toBe(404);
    expect(m.connectProject).not.toHaveBeenCalled();
    expect(m.disconnectProject).not.toHaveBeenCalled();
    expect(m.setOnPage).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    m.auth.mockResolvedValue(null);
    expect((await list.GET(new Request("http://x"), params({ id: "a1" }))).status).toBe(401);
    expect((await post({ projectId: "p2" })).status).toBe(401);
  });

  it("OPENLEN_ASSISTANT=0 is 404", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await list.GET(new Request("http://x"), params({ id: "a1" }))).status).toBe(404);
    expect((await post({ projectId: "p2" })).status).toBe(404);
    expect((await del("p2")).status).toBe(404);
    expect((await patch("p2", { onPage: true })).status).toBe(404);
  });
});
