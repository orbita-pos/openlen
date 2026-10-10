// @vitest-environment node
//
// Del Host al proyecto, para el servicio de Realtime (sin lib/backend/
// registry.ts, que arrastra los crates nativos y no se empaqueta en un .mjs):
// sólo la URL del proyecto, `<ref>.<base>`, la que usa supabase-js.
import { beforeEach, describe, expect, it, vi } from "vitest";

const filas: Record<string, unknown>[] = [];
const montados: string[] = [];
const entornos: Record<string, unknown>[] = [];
const MINE = "lienzo-0123456789abcdef0123456789abcdef";

vi.mock("@/lib/db", () => ({
  schema: { projectBackends: { ref: "ref" } },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => filas }) }) }) },
}));
vi.mock("@/lib/integrations/crypto", () => ({ decryptToken: (s: string) => `claro:${s}` }));
vi.mock("../pg", () => ({ projectDatabase: (name: string) => ({ name, transaction: async () => undefined }) }));
vi.mock("./provision", () => ({
  ensureRealtimeProvisioned: async (o: { scope: string }) => {
    montados.push(o.scope);
  },
}));
vi.mock("../environments", () => ({
  listEnvironments: async () => entornos,
  dbNameOf: (s: string) => `ol_${s}`,
  newScope: (ref: string, env: string) => `${ref}_${env === "draft" ? "d" : "l"}`,
}));
vi.mock("@/lib/lienzo/host", () => ({ etiquetaDeLienzo: () => MINE }));

const { realtimeProjectForHost, refFromHost } = await import("./project-lookup");

const REF = "abcdefghijklmnopqrst";
const BASES = ["openlen.app", "openlen.com"];

beforeEach(() => {
  filas.length = 0;
  montados.length = 0;
  entornos.length = 0;
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
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, null, BASES);
    expect(p).toMatchObject({ ref: REF, publishableKey: "sb_publishable_x", secretKeyHash: "h", jwtSecret: "claro:cifrado", db: { name: `ol_${REF}` } });
    expect(montados).toEqual([REF]);
  });

  it("sin base todavía: broadcast y presence sí (sin `db`), y no se monta nada", async () => {
    filas.push({ ref: REF, publishableKey: "k", secretKeyHash: "h", jwtSecretEncrypted: "c", provisionedAt: null });
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, null, BASES);
    expect(p).not.toBeNull();
    expect(p).not.toHaveProperty("db");
    expect(montados).toEqual([]);
  });

  it("un ref sin backend: null", async () => {
    expect(await realtimeProjectForHost(`${REF}.openlen.app`, null, BASES)).toBeNull();
  });
});

describe("realtimeProjectForHost por entorno (spec local 2026-10-09)", () => {
  const ROW = { ref: REF, projectId: "p1", publishableKey: "k", secretKeyHash: "h", jwtSecretEncrypted: "viejo", provisionedAt: new Date() };
  const draft = { environment: "draft", scope: `${REF}_d`, jwtSecretEncrypted: "del-borrador", provisionedAt: new Date() };
  const live = { environment: "live", scope: REF, jwtSecretEncrypted: "de-produccion", provisionedAt: new Date() };

  it("desde el lienzo de este proyecto: la base y el secreto del borrador, con su propia llave", async () => {
    filas.push(ROW);
    entornos.push(draft, live);
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, `https://${MINE}.openlen.app`, BASES);
    expect(p).toMatchObject({ ref: `${REF}_d`, jwtSecret: "claro:del-borrador", db: { name: `ol_${REF}_d` } });
  });

  it("desde la publicada: producción", async () => {
    filas.push(ROW);
    entornos.push(draft, live);
    const p = await realtimeProjectForHost(`${REF}.openlen.app`, "https://tienda.openlen.app", BASES);
    expect(p).toMatchObject({ ref: REF, jwtSecret: "claro:de-produccion", db: { name: `ol_${REF}` } });
  });

  it("desde el lienzo de otro proyecto: como si no existiera", async () => {
    filas.push(ROW);
    entornos.push(draft, live);
    expect(await realtimeProjectForHost(`${REF}.openlen.app`, "https://lienzo-ffffffffffffffffffffffffffffffff.openlen.app", BASES)).toBeNull();
  });
});
