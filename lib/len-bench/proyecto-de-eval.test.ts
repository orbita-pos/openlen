// Los proyectos de usar y tirar de Len-Bench también pueden tener base: Len
// corre `supabase db push` en los casos que la piden. Borrarlos tiene que
// llevársela, igual que `deleteProject`, o cada corrida deja una base y un rol
// `ol_<ref>` en el clúster de las páginas.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projects: { id: "id" },
  projectBackends: { projectId: "projectId", ref: "ref", provisionedAt: "provisionedAt" },
  backend: [] as Array<{ ref: string; provisionedAt: Date | null }>,
  envs: [] as Array<{ scope: string }>,
  borrados: [] as unknown[],
  dropProjectDatabase: vi.fn(async (_scope: string) => {}),
  dropDeveloperRole: vi.fn(async (_ref: string) => {}),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.backend }) }) }),
    delete: (table: unknown) => ({ where: async () => void mocks.borrados.push(table) }),
  },
  schema: { projects: mocks.projects, projectBackends: mocks.projectBackends },
}));
vi.mock("@/lib/backend/provision", () => ({ dropProjectDatabase: mocks.dropProjectDatabase, dropDeveloperRole: mocks.dropDeveloperRole }));
vi.mock("@/lib/backend/environments", () => ({ listEnvironments: async () => mocks.envs }));
vi.mock("@/lib/backend/storage/purge", () => ({ purgeProjectStorage: async () => {} }));
vi.mock("@/lib/backend/pg", () => ({ backendConfigured: () => true }));

import { deleteThrowawayProject } from "./proyecto-de-eval";

describe("deleteThrowawayProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.borrados = [];
  });

  it("🔴 se lleva las bases de los entornos del proyecto de eval y su rol", async () => {
    mocks.backend = [{ ref: "abcdefghijklmnopqrst", provisionedAt: new Date() }];
    mocks.envs = [{ scope: "abcdefghijklmnopqrst_d" }];
    await deleteThrowawayProject("p1");
    expect(mocks.borrados).toEqual([mocks.projects]);
    expect(mocks.dropProjectDatabase.mock.calls.map((c) => c[0])).toEqual(["abcdefghijklmnopqrst_d"]);
    expect(mocks.dropDeveloperRole).toHaveBeenCalledWith("abcdefghijklmnopqrst");
  });

  it("sin base, sólo borra el proyecto", async () => {
    mocks.backend = [];
    await deleteThrowawayProject("p1");
    expect(mocks.borrados).toEqual([mocks.projects]);
    expect(mocks.dropProjectDatabase).not.toHaveBeenCalled();
    expect(mocks.dropDeveloperRole).not.toHaveBeenCalled();
  });
});
