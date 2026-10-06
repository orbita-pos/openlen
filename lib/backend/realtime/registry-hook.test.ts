// @vitest-environment node
//
// Carril D: montar el esquema `realtime` va dentro de `ensureProvisioned`
// (lib/backend/registry.ts), como el de storage. Si falla, NO puede tumbar
// /rest/v1, /auth/v1 ni /storage/v1: se registra y sigue.
import { beforeEach, describe, expect, it, vi } from "vitest";

let falla = false;
const llamadas: string[] = [];

vi.mock("@/lib/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => {} }) }) }, schema: { projectBackends: {} } }));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: () => "pw", encryptToken: () => "x" }));
vi.mock("../storage/provision", () => ({ ensureStorageProvisioned: async () => {} }));
vi.mock("./provision", () => ({
  ensureRealtimeProvisioned: async (ref: string) => {
    llamadas.push(ref);
    if (falla) throw new Error("permission denied to set parameter \"log_min_messages\"");
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

describe("ensureProvisioned + Realtime", () => {
  it("monta realtime también en una base que ya estaba", async () => {
    await ensureProvisioned(REC);
    expect(llamadas).toEqual(["abcdefghijklmnopqrst"]);
  });

  it("si montar realtime falla, la base sigue sirviendo (no lanza; queda en el registro)", async () => {
    falla = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureProvisioned(REC)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith("[realtime] no se pudo montar el esquema realtime", REC.ref, expect.any(Error));
    err.mockRestore();
  });
});
