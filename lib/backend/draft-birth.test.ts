// @vitest-environment node
//
// El borrador NACE con las tablas de producción y el seed (spec local
// 2026-10-09, sección 7): `ensureEnvironmentReady` lo construye la primera vez,
// y producción, nunca desde aquí.
import { beforeEach, describe, expect, it, vi } from "vitest";

const builds: unknown[] = [];
const state: { draft: Record<string, unknown> | null; live: Record<string, unknown> | null } = { draft: null, live: null };

vi.mock("@/lib/db", () => ({ db: {}, schema: { projectBackends: {}, projectBackendEnvironments: {}, projects: {} } }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: () => "pw", encryptToken: () => "x" }));
vi.mock("./provision", () => ({ provisionDatabase: async () => {} }));
vi.mock("./storage/provision", () => ({ ensureStorageProvisioned: async () => {} }));
vi.mock("./realtime/provision", () => ({ ensureRealtimeProvisioned: async () => {} }));
vi.mock("./files", () => ({ listProjectFiles: async () => ({ "/supabase/seed.sql": "insert into t values (1);" }) }));
vi.mock("./draft", () => ({
  buildDraftDatabase: async (o: unknown) => {
    builds.push(o);
    return { ok: true, applied: [], seeded: true };
  },
}));
vi.mock("./environments", () => ({
  listEnvironments: async () => [state.draft, state.live].filter(Boolean),
  getEnvironment: async (_p: string, env: string) => (env === "draft" ? state.draft : state.live),
  createEnvironment: async () => {
    state.draft = { projectId: "p1", environment: "draft", scope: "abcdefghijklmnopqrst_d", jwtSecretEncrypted: "", readOnlyPasswordEncrypted: null, provisionedAt: null };
    return state.draft;
  },
  markEnvironmentProvisioned: async () => {},
  classifyExistingBackend: () => "draft",
  dbNameOf: (s: string) => `ol_${s}`,
}));

const { ensureEnvironmentReady } = await import("./registry");

const REC = {
  projectId: "p1",
  ref: "abcdefghijklmnopqrst",
  publishableKey: "",
  secretKeyHash: "",
  secretKeyEncrypted: "",
  jwtSecretEncrypted: "",
  dbPasswordEncrypted: "",
  authConfig: {},
  provisionedAt: null,
};

beforeEach(() => {
  builds.length = 0;
  state.draft = null;
  state.live = { projectId: "p1", environment: "live", scope: "abcdefghijklmnopqrst", jwtSecretEncrypted: "", readOnlyPasswordEncrypted: null, provisionedAt: new Date() };
});

describe("el borrador nace construido", () => {
  it("la primera vez: con las migraciones de producción y el seed del proyecto", async () => {
    await ensureEnvironmentReady(REC, "draft");
    expect(builds).toEqual([
      {
        draft: { scope: "abcdefghijklmnopqrst_d", ref: "abcdefghijklmnopqrst", password: "pw" },
        live: { scope: "abcdefghijklmnopqrst", ref: "abcdefghijklmnopqrst", password: "pw" },
        files: { "/supabase/seed.sql": "insert into t values (1);" },
        includeLocal: false,
      },
    ]);
  });

  it("si ya existía, no se reconstruye", async () => {
    state.draft = { projectId: "p1", environment: "draft", scope: "abcdefghijklmnopqrst_d", jwtSecretEncrypted: "", readOnlyPasswordEncrypted: null, provisionedAt: new Date() };
    await ensureEnvironmentReady(REC, "draft");
    expect(builds).toEqual([]);
  });

  it("producción nunca nace desde aquí", async () => {
    state.live = null;
    await expect(ensureEnvironmentReady(REC, "live")).rejects.toThrow(/nace al publicar/);
  });
});
