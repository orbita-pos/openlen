import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getProject: vi.fn(), deleteProject: vi.fn(), stopProject: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
// Mocked whole: its chain pulls in the native binding.
vi.mock("@/lib/projects", () => ({
  getProject: mocks.getProject,
  deleteProject: mocks.deleteProject,
  renameProject: vi.fn(),
  setProjectLogoUrl: vi.fn(),
  setProjectStatus: vi.fn(),
  setProjectUserBrief: vi.fn(),
  dismissDegradations: vi.fn(),
  USER_BRIEF_MAX: 10_000,
}));

vi.mock("@/lib/agent/subagents/registry", () => ({ stopProject: mocks.stopProject }));

import { DELETE, GET } from "./route";

const load = async () =>
  (await (await GET(new Request("http://localhost/api/projects/p1"), { params: Promise.resolve({ id: "p1" }) })).json()) as {
    project: { artifacts: unknown };
  };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.getProject.mockResolvedValue({ id: "p1", title: "Demo", data: {} });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/projects/[id]", () => {
  it("says whether deliverables are on, so the workspace bell asks nothing when they are off", async () => {
    vi.stubEnv("OPENLEN_ARTIFACTS", "");
    expect((await load()).project.artifacts).toBe(false);
    vi.stubEnv("OPENLEN_ARTIFACTS", "1");
    expect((await load()).project.artifacts).toBe(true);
  });
});

describe("DELETE /api/projects/[id]", () => {
  const remove = () => DELETE(new Request("http://localhost/api/projects/p1", { method: "DELETE" }), { params: Promise.resolve({ id: "p1" }) });

  it("stops the project's subagents once it is deleted", async () => {
    mocks.deleteProject.mockResolvedValue(true);
    expect((await remove()).status).toBe(200);
    expect(mocks.stopProject).toHaveBeenCalledWith("p1");
  });

  it("a project that is not yours stops nothing", async () => {
    mocks.deleteProject.mockResolvedValue(false);
    expect((await remove()).status).toBe(404);
    expect(mocks.stopProject).not.toHaveBeenCalled();
  });
});
