// @vitest-environment node
// GET /api/assistants/[id]/ab-decisions (review item 28): her projects were assigned once, but the person's access to each is
// asked on every request — a project they were removed from, or can only read, shows no test cards.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  served: [] as { projectId: string }[],
  roles: {} as Record<string, "dueno" | "editor" | "lector" | null>,
  pending: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => "u1" }));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => true }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: async () => ({ id: "a1", personId: "u1" }) }));
vi.mock("@/lib/assistants/projects", () => ({ projectsOfAssistant: async () => m.served }));
vi.mock("@/lib/ab/store", () => ({ pendingExperimentViewsForProjects: m.pending }));
vi.mock("@/lib/projects/acceso", () => ({
  accesoAlProyecto: async (projectId: string) => (m.roles[projectId] ? { rol: m.roles[projectId], duenoId: "owner" } : null),
  puede: (rol: string, permiso: string) => permiso === "ver" || rol !== "lector",
}));

const { GET } = await import("./route");

const call = () => GET(new Request("https://openlen.com/api/assistants/a1/ab-decisions"), { params: Promise.resolve({ id: "a1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.pending.mockResolvedValue([{ id: "ab_1" }]);
});

describe("the assistant's A/B decision cards", () => {
  it("🔴 only the projects where the person can edit TODAY: removed and read-only ones are left out", async () => {
    m.served = [{ projectId: "mine" }, { projectId: "edited" }, { projectId: "read-only" }, { projectId: "removed" }];
    m.roles = { mine: "dueno", edited: "editor", "read-only": "lector", removed: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.pending).toHaveBeenCalledWith(["mine", "edited"]);
    expect(await res.json()).toEqual({ decisions: [{ id: "ab_1" }] });
  });

  it("no project left: it asks for nothing (the store answers an empty list)", async () => {
    m.served = [{ projectId: "removed" }];
    m.roles = { removed: null };
    await call();
    expect(m.pending).toHaveBeenCalledWith([]);
  });
});
