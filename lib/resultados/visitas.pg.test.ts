// @vitest-environment node
// Las visitas contadas en la HORA DEL USUARIO. Base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { resumirVisitas } from "./visitas";

const USUARIO = "prueba-visitas-user";
const PROYECTO = "prueba-visitas-proyecto";
// 30/09 19:00 en Ciudad de México = 01/10 01:00 UTC: el día ya cambió en UTC.
const AHORA = new Date("2026-10-01T01:00:00Z");
const MX = "America/Mexico_City";

function vistas(n: number, ts: Date, prefijo: string, extra: Partial<typeof schema.pageEvents.$inferInsert> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    projectId: PROYECTO, type: "view", ts, uaHash: `${prefijo}-${i}`, page: null, ...extra,
  }));
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` }).onConflictDoNothing();
  await db.insert(schema.projects).values({ id: PROYECTO, userId: USUARIO, title: "visitas", brief: "visitas", data: { html: "<!doctype html><html><body></body></html>" } }).onConflictDoNothing();
  await db.insert(schema.pageEvents).values([
    // HOY en México (30/09 10:00 MX = 16:00Z): en UTC serían «ayer».
    ...vistas(3, new Date("2026-09-30T16:00:00Z"), "hoy", { referrer: "https://www.google.com/", device: "mobile" }),
    // AYER en México (29/09 12:00 MX = 18:00Z).
    ...vistas(5, new Date("2026-09-29T18:00:00Z"), "ayer", { device: "desktop" }),
    // Hace tres días (27/09 12:00 MX).
    ...vistas(20, new Date("2026-09-27T18:00:00Z"), "antes", { page: "menu" }),
    { projectId: PROYECTO, type: "click", ts: new Date("2026-09-30T16:05:00Z"), href: "https://wa.me/123", uaHash: "hoy-0" },
  ]);
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("resumirVisitas", () => {
  it("cuenta hoy y ayer en la hora de México, no en la de UTC", async () => {
    const r = await resumirVisitas(PROYECTO, MX, {}, AHORA);
    expect(r.hoy).toEqual({ vistas: 3, personas: 3, clics: 1 });
    expect(r.ayer).toEqual({ vistas: 5, personas: 5, clics: 0 });
    expect(r.ultimos7.vistas).toBe(28);
  });
  it("en UTC el mismo instante da otros días (la trampa que esto arregla)", async () => {
    const r = await resumirVisitas(PROYECTO, "UTC", {}, AHORA);
    expect(r.hoy.vistas).toBe(0);
    expect(r.ayer.vistas).toBe(3);
  });
  it("el detalle del rango: por día, páginas, de dónde y dispositivos", async () => {
    const r = await resumirVisitas(PROYECTO, MX, {}, AHORA);
    expect(r.rango).toMatchObject({ desde: "2026-09-24", hasta: "2026-09-30" });
    expect(r.rango.porDia).toEqual([
      { dia: "2026-09-27", vistas: 20 },
      { dia: "2026-09-29", vistas: 5 },
      { dia: "2026-09-30", vistas: 3 },
    ]);
    expect(r.rango.paginas[0]).toEqual({ pagina: "/menu", vistas: 20 });
    expect(r.rango.deDonde).toContainEqual({ origen: "www.google.com", vistas: 3 });
    expect(r.rango.dispositivos).toContainEqual({ dispositivo: "mobile", vistas: 3 });
  });
  it("un rango de más de 90 días se recorta y lo dice", async () => {
    const r = await resumirVisitas(PROYECTO, MX, { desde: "2026-01-01", hasta: "2026-09-30" }, AHORA);
    expect(r.recortadoDesde).toBe("2026-07-03");
    expect(r.rango.desde).toBe("2026-07-03");
  });
});
