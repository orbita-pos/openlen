// @vitest-environment node
//
// Carril D: montar el esquema `storage` va dentro de `ensureProvisioned`
// (lib/backend/registry.ts), por donde pasan TODAS las peticiones del backend.
// Si falla, NO puede tumbar /rest/v1 ni /auth/v1, que ya funcionaban: se
// registra y sigue. La ruta de Storage lo exige ella misma (handler.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

let falla = false;
const llamadas: string[] = [];

vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => {} }) }) }, schema: { projectBackends: {} } }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: () => "pw", encryptToken: () => "x" }));
vi.mock("./provision", () => ({
  ensureStorageProvisioned: async (ref: string) => {
    llamadas.push(ref);
    if (falla) throw new Error("permission denied to grant role");
  },
}));
vi.mock("../provision", () => ({ provisionDatabase: async () => {} }));

const { ensureProvisioned } = await import("../registry");

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

describe("ensureProvisioned + Storage", () => {
  it("monta storage también en una base que ya estaba", async () => {
    await ensureProvisioned(REC);
    expect(llamadas).toEqual(["abcdefghijklmnopqrst"]);
  });

  it("si montar storage falla, la base sigue sirviendo (no lanza; queda en el registro)", async () => {
    falla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureProvisioned(REC)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
