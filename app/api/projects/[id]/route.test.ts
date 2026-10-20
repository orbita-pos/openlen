import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getProject: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
// Mocked whole: its chain pulls in the native binding.
vi.mock("@/lib/projects", () => ({
  getProject: mocks.getProject,
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectLogoUrl: vi.fn(),
  setProjectStatus: vi.fn(),
  setProjectUserBrief: vi.fn(),
  dismissDegradations: vi.fn(),
  USER_BRIEF_MAX: 10_000,
}));

import { GET } from "./route";

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
