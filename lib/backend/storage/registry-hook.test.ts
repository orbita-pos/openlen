// @vitest-environment node
//
// Carril D: montar el esquema `storage` va dentro de `ensureEnvironmentReady`
// (lib/backend/registry.ts), por donde pasan TODAS las peticiones del backend.
// Si falla, NO puede tumbar /rest/v1 ni /auth/v1, que ya funcionaban: se
// registra y sigue. La ruta de Storage lo exige ella misma (handler.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

let falla = false;
const llamadas: string[] = [];

vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => {} }) }) }, schema: { projectBackends: {} } }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: () => "pw", encryptToken: () => "x" }));
vi.mock("./provision", () => ({
  ensureStorageProvisioned: async (o: { scope: string }) => {
    llamadas.push(o.scope);
    if (falla) throw new Error("permission denied to grant role");
  },
}));
vi.mock("../provision", () => ({ provisionDatabase: async () => {} }));
vi.mock("../realtime/provision", () => ({ ensureRealtimeProvisioned: async () => {} }));

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

describe("ensureEnvironmentReady + Storage", () => {
  it("monta storage también en una base que ya estaba", async () => {
    await ensureEnvironmentReady(REC, "live");
    expect(llamadas).toEqual(["abcdefghijklmnopqrst"]);
  });

  it("si montar storage falla, la base sigue sirviendo (no lanza; queda en el registro)", async () => {
    falla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureEnvironmentReady(REC, "live")).resolves.toMatchObject({ scope: "abcdefghijklmnopqrst" });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
