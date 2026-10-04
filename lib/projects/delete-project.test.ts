// 🔴 BORRAR UN PROYECTO SE LLEVA LA BASE DE SU PÁGINA.
//
// La base vive en OTRO clúster (el de las páginas) y la fila de
// `projectBackends` que dice cuál es se va en cascada con la del proyecto. Hasta
// el 04/10 `deleteProject` no miraba nada de eso: la base y el rol `ol_<ref>`
// se quedaban en el clúster con las cuentas de los visitantes dentro, y sin la
// fila ya nadie sabía de quién eran.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projects: { id: "id", userId: "userId", subdomain: "subdomain" },
  projectBackends: { projectId: "projectId", ref: "ref" },
  owned: [{ subdomain: null as string | null }],
  backend: [] as Array<{ ref: string }>,
  deleted: [{ id: "p1" }],
  dropProjectDatabase: vi.fn(async (_ref: string) => {}),
  backendConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (table === mocks.projectBackends ? mocks.backend : mocks.owned),
        }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: async () => mocks.deleted }) }),
  },
  schema: { projects: mocks.projects, projectBackends: mocks.projectBackends },
}));
vi.mock("@/lib/publish/filesystem", () => ({ unpublishDir: vi.fn(async () => {}) }));
vi.mock("@/lib/backend/provision", () => ({ dropProjectDatabase: mocks.dropProjectDatabase }));
vi.mock("@/lib/backend/pg", () => ({ backendConfigured: mocks.backendConfigured }));

import { deleteProject } from "@/lib/projects";

const REF = "abcdefghijklmnopqrst";

describe("deleteProject y la base de la página", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.owned = [{ subdomain: null }];
    mocks.backend = [{ ref: REF }];
    mocks.deleted = [{ id: "p1" }];
    mocks.backendConfigured.mockReturnValue(true);
    mocks.dropProjectDatabase.mockResolvedValue(undefined);
  });

  it("🔴 borra la base del proyecto que la tenía", async () => {
    expect(await deleteProject("p1", "u1")).toBe(true);
    expect(mocks.dropProjectDatabase).toHaveBeenCalledWith(REF);
  });

  it("no toca nada si el proyecto no es tuyo", async () => {
    mocks.owned = [];
    mocks.deleted = [];
    expect(await deleteProject("p1", "otro")).toBe(false);
    expect(mocks.dropProjectDatabase).not.toHaveBeenCalled();
  });

  it("un proyecto sin base no pide borrar ninguna", async () => {
    mocks.backend = [];
    await deleteProject("p1", "u1");
    expect(mocks.dropProjectDatabase).not.toHaveBeenCalled();
  });

  it("sin el clúster de las páginas configurado no lo intenta", async () => {
    mocks.backendConfigured.mockReturnValue(false);
    await deleteProject("p1", "u1");
    expect(mocks.dropProjectDatabase).not.toHaveBeenCalled();
  });

  it("si el clúster falla, el proyecto queda borrado igual y se dice en el registro", async () => {
    mocks.dropProjectDatabase.mockRejectedValue(new Error("connection refused"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await deleteProject("p1", "u1")).toBe(true);
      expect(spy.mock.calls.some((c) => c.join(" ").includes(REF))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
