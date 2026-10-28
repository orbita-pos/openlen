// @vitest-environment node
// Postgres en memoria: nunca carga credenciales ni conecta una base real.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { huella } from "./secreto";
const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), get db() { return base.db; } }));
import { guardarAvisos, borrarAvisos, avisosActivos } from "./avisos";
import { migrarAvisos } from "./avisos-migracion";
let pg: PGlite;
const llaveAna = "a".repeat(43), llaveBeto = "b".repeat(43);
beforeAll(async () => {
  pg = new PGlite(); base.db = drizzle(pg);
  await pg.exec('CREATE TABLE users (id text PRIMARY KEY); CREATE TABLE "movilLlaves" (huella text PRIMARY KEY, "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE);');
  await migrarAvisos(drizzle(pg)); await migrarAvisos(drizzle(pg));
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE; INSERT INTO users VALUES (\'ana\'), (\'beto\');');
  await pg.query('INSERT INTO "movilLlaves" VALUES ($1, \'ana\'), ($2, \'beto\')', [huella(llaveAna), huella(llaveBeto)]);
});
afterAll(async () => { await pg?.close(); });
describe("suscripción por llave", () => {
  it("alta y rotación reemplazan un único token", async () => {
    await guardarAvisos("ana", llaveAna, "token-1"); await guardarAvisos("ana", llaveAna, "token-2");
    expect((await pg.query('SELECT token FROM "movilAvisos"')).rows).toEqual([{ token: "token-2" }]);
    expect(await avisosActivos("ana", llaveAna)).toBe(true);
  });
  it("no registra una llave que pertenece a otro usuario", async () => {
    await expect(guardarAvisos("beto", llaveAna, "token-robado")).rejects.toThrow();
    expect((await pg.query('SELECT token FROM "movilAvisos"')).rows).toEqual([]);
  });
  it("otro usuario no ve ni da de baja la suscripción", async () => {
    await guardarAvisos("ana", llaveAna, "token-1"); await borrarAvisos("beto", llaveAna);
    expect(await avisosActivos("beto", llaveAna)).toBe(false);
    expect(await avisosActivos("ana", llaveAna)).toBe(true);
  });
  it("una sesión no se apropia del token de otra", async () => {
    await guardarAvisos("ana", llaveAna, "token-1");
    await expect(guardarAvisos("beto", llaveBeto, "token-1")).rejects.toThrow();
    expect(await avisosActivos("beto", llaveBeto)).toBe(false);
    expect(await avisosActivos("ana", llaveAna)).toBe(true);
  });
  it("revocar la llave borra el token por cascada", async () => {
    await guardarAvisos("ana", llaveAna, "token-1");
    await pg.query('DELETE FROM "movilLlaves" WHERE huella = $1', [huella(llaveAna)]);
    expect((await pg.query('SELECT token FROM "movilAvisos"')).rows).toEqual([]);
  });
});
