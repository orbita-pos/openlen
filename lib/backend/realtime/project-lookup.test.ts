// @vitest-environment node
//
// Del Host al proyecto, para el servicio de Realtime (sin lib/backend/
// registry.ts, que arrastra los crates nativos y no se empaqueta en un .mjs):
// sólo la URL del proyecto, `<ref>.<base>`, la que usa supabase-js.
import { beforeEach, describe, expect, it, vi } from "vitest";

const filas: Record<string, unknown>[] = [];
const montados: string[] = [];

vi.mock("@/lib/db", () => ({
  schema: { projectBackends: { ref: "ref" } },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => filas }) }) }) },
}));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: (s: string) => `claro:${s}` }));
vi.mock("../pg", () => ({ projectDatabase: (name: string) => ({ name, transaction: async () => undefined }) }));
vi.mock("./provision", () => ({
  ensureRealtimeProvisioned: async (ref: string) => {
    montados.push(ref);
  },
}));

const { realtimeProjectForHost, refFromHost } = await import("./project-lookup");

const REF = "abcdefghijklmnopqrst";
const BASES = ["openlen.app", "openlen.com"];

beforeEach(() => {
  filas.length = 0;
  montados.length = 0;
});

describe("refFromHost", () => {
  it("la URL del proyecto, con o sin puerto y en mayúsculas", () => {
    expect(refFromHost(`${REF}.openlen.app`, BASES)).toBe(REF);
    expect(refFromHost(`${REF.toUpperCase()}.OPENLEN.APP:443`, BASES)).toBe(REF);
  });
  it("el host de una página, otro dominio o nada: null", () => {
    expect(refFromHost("tienda.openlen.app", BASES)).toBeNull();
    expect(refFromHost(`${REF}.otro.com`, BASES)).toBeNull();
    expect(refFromHost(`x.${REF}.openlen.app`, BASES)).toBeNull();
    expect(refFromHost("", BASES)).toBeNull();
  });
});

describe("realtimeProjectForHost", () => {
  it("con la base ya creada: sus claves, su secreto descifrado, su base y el esquema realtime montado", async () => {
    filas.push({ ref: REF, publishableKey: "sb_publishable_x", secretKeyHash: "h", jwtSecretEncrypted: "cifrado", provisionedAt: new Date() });
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, BASES);
    expect(p).toMatchObject({ ref: REF, publishableKey: "sb_publishable_x", secretKeyHash: "h", jwtSecret: "claro:cifrado", db: { name: `ol_${REF}` } });
    expect(montados).toEqual([REF]);
  });

  it("sin base todavía: broadcast y presence sí (sin `db`), y no se monta nada", async () => {
    filas.push({ ref: REF, publishableKey: "k", secretKeyHash: "h", jwtSecretEncrypted: "c", provisionedAt: null });
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, BASES);
    expect(p).not.toBeNull();
    expect(p).not.toHaveProperty("db");
    expect(montados).toEqual([]);
  });

  it("un ref sin backend: null", async () => {
    expect(await realtimeProjectForHost(`${REF}.openlen.app`, BASES)).toBeNull();
  });
});
