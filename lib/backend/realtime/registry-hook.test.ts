// @vitest-environment node
//
// Carril D: montar el esquema `realtime` va dentro de `ensureEnvironmentReady`
// (lib/backend/registry.ts), como el de storage. Si falla, NO puede tumbar
// /rest/v1, /auth/v1 ni /storage/v1: se registra y sigue.
import { beforeEach, describe, expect, it, vi } from "vitest";

let falla = false;
const llamadas: string[] = [];

vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => {} }) }) }, schema: { projectBackends: {} } }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: () => "pw", encryptToken: () => "x" }));
vi.mock("../storage/provision", () => ({ ensureStorageProvisioned: async () => {} }));
vi.mock("./provision", () => ({
  ensureRealtimeProvisioned: async (o: { scope: string }) => {
    llamadas.push(o.scope);
    if (falla) throw new Error("permission denied to set parameter \"log_min_messages\"");
  },
}));
vi.mock("../provision", () => ({ provisionDatabase: async () => {} }));

vi.mock("../environments", () => {
  const ENV = { projectId: "p1", environment: "live", scope: "abcdefghijklmnopqrst", jwtSecretEncrypted: "", readOnlyPasswordEncrypted: null, provisionedAt: new Date() };
  return {
    listEnvironments: async () => [ENV],
    getEnvironment: async () => ENV,
    createEnvironment: async () => ENV,
    markEnvironmentProvisioned: async () => {},
    classifyExistingBackend: () => "live",
    dbNameOf: (s: string) => `ol_${s}`,
  };
});

const { ensureEnvironmentReady } = await import("../registry");

const REC = {
  projectId: "p1",
  ref: "abcdefghijklmnopqrst",
  publishableKey: "",
  secretKeyHash: "",
  secretKeyEncrypted: "",
  jwtSecretEncrypted: "",
  dbPasswordEncrypted: "",
  authConfig: {},
  provisionedAt: new Date(),
};

beforeEach(() => {
  falla = false;
  llamadas.length = 0;
});

describe("ensureEnvironmentReady + Realtime", () => {
  it("monta realtime también en una base que ya estaba", async () => {
    await ensureEnvironmentReady(REC, "live");
    expect(llamadas).toEqual(["abcdefghijklmnopqrst"]);
  });

  it("si montar realtime falla, la base sigue sirviendo (no lanza; queda en el registro)", async () => {
    falla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureEnvironmentReady(REC, "live")).resolves.toMatchObject({ scope: "abcdefghijklmnopqrst" });
    expect(err).toHaveBeenCalledWith("[realtime] no se pudo montar el esquema realtime", REC.ref, expect.any(Error));
    err.mockRestore();
  });
});
