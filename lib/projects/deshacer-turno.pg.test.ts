// @vitest-environment node
//
// DESHACER UN TURNO ENTERO, CONTRA POSTGRES (F2 de las apps web, spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, H7). Hecho cuando: «un
// turno que tocó 4 ficheros se deshace con un clic, y uno que el dueño tocó
// después se niega con su motivo». Aquí, además, que NUNCA queda a medias: lo
// que se comprueba al planear se vuelve a comprobar dentro de la sentencia.
//
// Corre contra la base de DATABASE_URL, como escribir-data.pg.test.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { cambiosDelTurnoParaDeshacer, planearDeshacer } from "@/lib/projects/deshacer-turno-plan";
import { TURNOS_GUARDADOS, deshacerTurno, escribirDeshacer, guardarCambiosDelTurno } from "@/lib/projects/deshacer-turno";
import type { ProjectData } from "@/lib/projects/types";

const USUARIO = "prueba-deshacer-turno-user";
const OTRO = "prueba-deshacer-turno-otro";
const PROYECTO = "prueba-deshacer-turno";
const TURNO = "11111111-1111-4111-8111-111111111111";

/** El proyecto ANTES del turno. */
const ANTES_DATA: ProjectData = { html: "<p>home 1</p>", pages: { menu: { html: "<h1>menú 1</h1>", title: "Menú" } } };
const ANTES_FICHEROS: Record<string, string> = { "/src/App.jsx": "app 1", "/src/Viejo.jsx": "viejo", "/css/x.css": "css" };
/** Y DESPUÉS: cambió la home, el menú, App.jsx; creó Nuevo.jsx y la página
 *  /nueva; borró Viejo.jsx; y añadió una migración (que no vuelve). */
const DESPUES_DATA: ProjectData = {
  html: "<p>home 2</p>",
  pages: { menu: { html: "<h1>menú 2</h1>", title: "Menú" }, nueva: { html: "<h1>nueva</h1>" } },
};
const DESPUES_FICHEROS: Record<string, string> = {
  "/src/App.jsx": "app 2",
  "/src/Nuevo.jsx": "nuevo",
  "/css/x.css": "css",
  "/supabase/migrations/20261007000000_x.sql": "create table x();",
};

function foto(data: ProjectData, ficheros: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...ficheros, "/index.html": data.html };
  for (const [slug, p] of Object.entries(data.pages ?? {})) out[`/${slug}/index.html`] = p.html;
  return out;
}

async function ponerProyecto(data: ProjectData, ficheros: Record<string, string>) {
  await db.delete(schema.projectTurnChanges).where(eq(schema.projectTurnChanges.projectId, PROYECTO));
  await db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, PROYECTO));
  await db.delete(schema.projectFileVersions).where(eq(schema.projectFileVersions.projectId, PROYECTO));
  await db.delete(schema.projectVersions).where(eq(schema.projectVersions.projectId, PROYECTO));
  await db.update(schema.projects).set({ data }).where(eq(schema.projects.id, PROYECTO));
  if (Object.keys(ficheros).length > 0) {
    await db.insert(schema.projectFiles).values(Object.entries(ficheros).map(([path, content]) => ({ projectId: PROYECTO, path, content })));
  }
}

async function estado() {
  const [p] = await db.select({ data: schema.projects.data, filesHash: schema.projects.filesHash }).from(schema.projects).where(eq(schema.projects.id, PROYECTO));
  const filas = await db.select({ path: schema.projectFiles.path, content: schema.projectFiles.content }).from(schema.projectFiles).where(eq(schema.projectFiles.projectId, PROYECTO));
  return { data: p!.data as ProjectData, filesHash: p!.filesHash, ficheros: Object.fromEntries(filas.map((f) => [f.path, f.content])) };
}

beforeEach(async () => {
  for (const id of [USUARIO, OTRO]) {
    await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido` }).onConflictDoNothing();
  }
  await db
    .insert(schema.projects)
    .values({ id: PROYECTO, userId: USUARIO, title: "Prueba deshacer", brief: "prueba", data: ANTES_DATA })
    .onConflictDoNothing();
  // El turno: el proyecto pasa de ANTES a DESPUÉS y se guarda lo que cambió.
  await ponerProyecto(DESPUES_DATA, DESPUES_FICHEROS);
  await guardarCambiosDelTurno(PROYECTO, TURNO, cambiosDelTurnoParaDeshacer(foto(ANTES_DATA, ANTES_FICHEROS), foto(DESPUES_DATA, DESPUES_FICHEROS)));
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  for (const id of [USUARIO, OTRO]) await db.delete(schema.users).where(eq(schema.users.id, id));
});

describe("deshacer un turno entero", () => {
  it("🔴 páginas y ficheros vuelven a como estaban al empezar, de una vez", async () => {
    const r = await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const ahora = await estado();
    expect(ahora.data.html).toBe("<p>home 1</p>");
    expect(ahora.data.pages?.menu).toEqual({ html: "<h1>menú 1</h1>", title: "Menú" });
    expect(ahora.data.pages?.nueva).toBeUndefined();
    // La migración no vuelve, y se dice.
    expect(ahora.ficheros).toEqual({ ...ANTES_FICHEROS, "/supabase/migrations/20261007000000_x.sql": "create table x();" });
    expect(r.noSeDeshacen).toEqual(["/supabase/migrations/20261007000000_x.sql"]);
    expect(r.ficheros).toEqual(["/src/App.jsx", "/src/Nuevo.jsx", "/src/Viejo.jsx"]);
    expect(r.paginas).toEqual([
      { page: null, html: "<p>home 1</p>" },
      { page: "menu", html: "<h1>menú 1</h1>" },
    ]);
    // La huella de lo publicable, al día: «cambios sin publicar» no miente.
    const { folderFingerprint } = await import("@/lib/projects/files-hash");
    expect(ahora.filesHash).toBe(folderFingerprint(ahora.ficheros as Record<string, string>));
  });

  it("deja historia: la página en Versiones y el «antes» de cada fichero", async () => {
    await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO });
    const versiones = await db.select({ label: schema.projectVersions.label, page: schema.projectVersions.page }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, PROYECTO));
    expect(versiones.filter((v) => v.label === "Undo turn").map((v) => v.page).sort()).toEqual(["menu", null].sort());
    const deFicheros = await db.select({ path: schema.projectFileVersions.path, content: schema.projectFileVersions.content }).from(schema.projectFileVersions).where(eq(schema.projectFileVersions.projectId, PROYECTO));
    expect(deFicheros.find((v) => v.path === "/src/App.jsx")?.content).toBe("app 2");
    expect(deFicheros.find((v) => v.path === "/src/Viejo.jsx")?.content).toBeNull();
  });

  it("🔴 si el dueño cambió DESPUÉS un fichero del turno: se niega, dice cuál, y no toca NADA", async () => {
    await db
      .update(schema.projectFiles)
      .set({ content: "app 2 + lo que escribió el dueño" })
      .where(and(eq(schema.projectFiles.projectId, PROYECTO), eq(schema.projectFiles.path, "/src/App.jsx")));
    const antes = await estado();
    const r = await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO });
    expect(r).toEqual({ ok: false, motivo: "se_solapan", rutas: ["/src/App.jsx"] });
    expect(await estado()).toEqual(antes);
    const pendientes = await db.select({ undoneAt: schema.projectTurnChanges.undoneAt }).from(schema.projectTurnChanges).where(eq(schema.projectTurnChanges.turnId, TURNO));
    expect(pendientes.every((f) => f.undoneAt === null)).toBe(true);
  });

  it("🔴 LA SENTENCIA vuelve a mirar: si un fichero cambia ENTRE el plan y la escritura, no escribe nada", async () => {
    // El plan, con el estado de ahora…
    const [p] = await db.select({ data: schema.projects.data, updatedAt: schema.projects.updatedAt }).from(schema.projects).where(eq(schema.projects.id, PROYECTO));
    const { sql } = await import("drizzle-orm");
    const [{ base }] = (await db.execute(sql`select "updatedAt"::text as base from "projects" where id = ${PROYECTO}`)).rows as Array<{ base: string }>;
    const ficheros = (await estado()).ficheros as Record<string, string>;
    const filas = await db.select().from(schema.projectTurnChanges).where(eq(schema.projectTurnChanges.turnId, TURNO));
    const plan = planearDeshacer(
      filas.map((f) => ({ ruta: f.path, antes: f.contentBefore, despues: f.contentAfter, deshacible: f.undoable })),
      { data: p!.data as ProjectData, ficheros },
    );
    if (!plan.ok) throw new Error("el plan tenía que salir");
    // …y el dueño escribe JUSTO entonces, en un fichero que el turno había creado.
    await db
      .update(schema.projectFiles)
      .set({ content: "nuevo, retocado" })
      .where(and(eq(schema.projectFiles.projectId, PROYECTO), eq(schema.projectFiles.path, "/src/Nuevo.jsx")));
    const antes = await estado();
    const fila = await escribirDeshacer({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO, plan, base, ficheros, deshacerId: "x" });
    expect(fila).toEqual({ actualizado: 0, pendiente: 1, choques: ["/src/Nuevo.jsx"] });
    expect(await estado()).toEqual(antes);
  });

  it("deshecho una vez, no se deshace dos; y deshacer el deshacer lo devuelve todo", async () => {
    const r = await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: TURNO })).toEqual({ ok: false, motivo: "ya_deshecho" });
    const otraVez = await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: r.deshacerId });
    expect(otraVez.ok, JSON.stringify(otraVez)).toBe(true);
    const ahora = await estado();
    expect(ahora.data).toEqual(DESPUES_DATA);
    expect(ahora.ficheros).toEqual(DESPUES_FICHEROS);
  });

  it("ni un turno sin registro ni el proyecto de otro", async () => {
    expect(await deshacerTurno({ projectId: PROYECTO, userId: USUARIO, turnId: "no-existe" })).toEqual({ ok: false, motivo: "sin_registro" });
    expect(await deshacerTurno({ projectId: PROYECTO, userId: OTRO, turnId: TURNO })).toEqual({ ok: false, motivo: "no_encontrado" });
  });

  it(`guarda los últimos ${TURNOS_GUARDADOS} turnos, no más`, async () => {
    for (let i = 0; i < TURNOS_GUARDADOS + 2; i++) {
      await guardarCambiosDelTurno(PROYECTO, `turno-${String(i).padStart(2, "0")}`, [{ ruta: "/css/x.css", antes: "a", despues: "b", deshacible: true }]);
    }
    const turnos = new Set(
      (await db.select({ t: schema.projectTurnChanges.turnId }).from(schema.projectTurnChanges).where(eq(schema.projectTurnChanges.projectId, PROYECTO))).map((f) => f.t),
    );
    expect(turnos.size).toBe(TURNOS_GUARDADOS);
    expect(turnos.has(`turno-${String(TURNOS_GUARDADOS + 1).padStart(2, "0")}`)).toBe(true);
    expect(turnos.has(TURNO)).toBe(false);
  });

  it("guardar el mismo turno dos veces no lo duplica", async () => {
    await guardarCambiosDelTurno(PROYECTO, TURNO, [{ ruta: "/css/x.css", antes: "a", despues: "b", deshacible: true }]);
    const filas = await db.select().from(schema.projectTurnChanges).where(eq(schema.projectTurnChanges.turnId, TURNO));
    expect(filas).toHaveLength(1);
  });
});
