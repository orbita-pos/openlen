// @vitest-environment node
//
// COMPARTIR EL PROYECTO, CONTRA POSTGRES: quién entra a qué
// (lib/projects/acceso.ts) y las invitaciones (lib/projects/miembros.ts).
// Corre contra la base de DATABASE_URL, como deshacer-turno.pg.test.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { accesoAlProyecto, exigirAcceso, puede } from "@/lib/projects/acceso";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import { createVersion, listVersions } from "@/lib/projects/versions";
import {
  MAX_MIEMBROS,
  aceptarInvitacion,
  cambiarRol,
  gastoDeMiembrosDelMes,
  hayInvitacionesPendientes,
  invitar,
  listarMiembros,
  margenDeMiembros,
  ponerTope,
  proyectosCompartidos,
  quitarMiembro,
  sumarGasto,
} from "@/lib/projects/miembros";

const DUENO = "prueba-miembros-dueno";
const ANA = "prueba-miembros-ana";
const LUIS = "prueba-miembros-luis";
const EXTRANO = "prueba-miembros-extrano";
const PROYECTO = "prueba-miembros";
const correo = (id: string) => `${id}@ejemplo.invalido`;

beforeEach(async () => {
  for (const id of [DUENO, ANA, LUIS, EXTRANO]) {
    await db.insert(schema.users).values({ id, email: correo(id), name: id.replace("prueba-miembros-", "") }).onConflictDoNothing();
  }
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "Compartido", brief: "", data: { html: "<p>x</p>" } });
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(inArray(schema.users.id, [DUENO, ANA, LUIS, EXTRANO]));
});

describe("quién entra a un proyecto", () => {
  it("los roles: el lector sólo ve; el editor y el dueño, también editan", () => {
    expect(puede("lector", "ver")).toBe(true);
    expect(puede("lector", "editar")).toBe(false);
    expect(puede("editor", "editar")).toBe(true);
    expect(puede("dueno", "editar")).toBe(true);
  });

  it("🔴 sin invitación aceptada, nadie más que el dueño entra (404, no 403)", async () => {
    expect(await accesoAlProyecto(PROYECTO, DUENO)).toEqual({ rol: "dueno", duenoId: DUENO });
    expect(await accesoAlProyecto(PROYECTO, EXTRANO)).toBeNull();
    expect(await accesoAlProyecto("no-existe", DUENO)).toBeNull();
    const r = await exigirAcceso(PROYECTO, EXTRANO, "ver");
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(404);
    // Una invitación SIN aceptar no da acceso.
    expect(await hayInvitacionesPendientes(PROYECTO)).toBe(false);
    const r2 = await invitar(PROYECTO, DUENO, correo(ANA), "editor");
    expect(await accesoAlProyecto(PROYECTO, ANA)).toBeNull();
    // …pero el chat del dueño sabe que alguien puede llegar, y deja de saberlo al aceptarse.
    expect(await hayInvitacionesPendientes(PROYECTO)).toBe(true);
    if (r2.ok) await aceptarInvitacion(r2.token, ANA, correo(ANA));
    expect(await hayInvitacionesPendientes(PROYECTO)).toBe(false);
  });

  it("🔴 la invitación sólo la acepta el correo invitado, una vez; luego entra con su rol", async () => {
    const r = await invitar(PROYECTO, DUENO, correo(ANA), "lector");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Con otra cuenta no casa, y el enlace NO se quema.
    expect(await aceptarInvitacion(r.token, EXTRANO, correo(EXTRANO))).toBeNull();
    expect(await aceptarInvitacion(r.token, ANA, correo(ANA).toUpperCase())).toEqual({ projectId: PROYECTO, rol: "lector" });
    // De un solo uso.
    expect(await aceptarInvitacion(r.token, ANA, correo(ANA))).toBeNull();
    expect(await accesoAlProyecto(PROYECTO, ANA)).toEqual({ rol: "lector", duenoId: DUENO });
    const lector = await exigirAcceso(PROYECTO, ANA, "editar");
    expect((lector as Response).status).toBe(403);
    // Cambiarle el rol la deja editar; quitarla la deja fuera.
    expect(await cambiarRol(PROYECTO, ANA, "editor")).toBe(true);
    expect(await exigirAcceso(PROYECTO, ANA, "editar")).toEqual({ rol: "editor", duenoId: DUENO });
    expect(await proyectosCompartidos(ANA)).toMatchObject([{ projectId: PROYECTO, rol: "editor", duenoEmail: correo(DUENO) }]);
    expect(await quitarMiembro(PROYECTO, ANA)).toBe(true);
    expect(await accesoAlProyecto(PROYECTO, ANA)).toBeNull();
  });

  it("no se invita al dueño ni dos veces al mismo miembro; hay un máximo", async () => {
    expect(await invitar(PROYECTO, DUENO, correo(DUENO), "editor")).toEqual({ ok: false, motivo: "tu_mismo" });
    const r = await invitar(PROYECTO, DUENO, correo(LUIS), "editor");
    if (r.ok) await aceptarInvitacion(r.token, LUIS, correo(LUIS));
    expect(await invitar(PROYECTO, DUENO, correo(LUIS), "lector")).toEqual({ ok: false, motivo: "ya_es_miembro" });
    // Reinvitar a un correo pendiente sustituye la invitación, no suma.
    await invitar(PROYECTO, DUENO, "pendiente@ejemplo.invalido", "editor");
    await invitar(PROYECTO, DUENO, "pendiente@ejemplo.invalido", "lector");
    const { miembros, invitaciones } = await listarMiembros(PROYECTO);
    expect(miembros.map((m) => m.userId)).toEqual([LUIS]);
    expect(invitaciones).toMatchObject([{ email: "pendiente@ejemplo.invalido", rol: "lector" }]);
    for (let i = invitaciones.length + miembros.length; i < MAX_MIEMBROS; i++) await invitar(PROYECTO, DUENO, `n${i}@ejemplo.invalido`, "lector");
    expect(await invitar(PROYECTO, DUENO, "uno-mas@ejemplo.invalido", "lector")).toEqual({ ok: false, motivo: "limite" });
  });

  it("🔴 el gasto de los miembros se suma por mes y el tope dice cuánto queda", async () => {
    expect(await margenDeMiembros(PROYECTO)).toBeNull();
    await ponerTope(PROYECTO, 100);
    await sumarGasto(PROYECTO, ANA, 30);
    await sumarGasto(PROYECTO, ANA, 25);
    await sumarGasto(PROYECTO, LUIS, 10);
    expect(await gastoDeMiembrosDelMes(PROYECTO)).toBe(65);
    expect(await margenDeMiembros(PROYECTO)).toBe(35);
    await sumarGasto(PROYECTO, LUIS, 80);
    expect(await margenDeMiembros(PROYECTO)).toBe(0);
  });

  it("🔴 una versión que hizo un miembro lleva su nombre; la del dueño, no", async () => {
    await db.delete(schema.projectVersions).where(eq(schema.projectVersions.projectId, PROYECTO));
    await conAutor(ANA, () => createVersion({ projectId: PROYECTO, html: "<p>de Ana</p>", label: "Code editor: index.html", source: "chat" }));
    await conAutor(DUENO, () => createVersion({ projectId: PROYECTO, html: "<p>del dueño</p>", label: "Code editor: index.html", source: "chat" }));
    await createVersion({ projectId: PROYECTO, html: "<p>sin autor</p>", label: "Publicado", source: "publish" });
    const lista = await listVersions({ projectId: PROYECTO, userId: DUENO });
    // De la más nueva a la más vieja: sin autor, el dueño (sin firma), Ana.
    expect(lista.map((v) => v.autor)).toEqual([null, null, "ana"]);
  });

  it("🔴 cada miembro lleva su foto (la subida o la de Google) y su @", async () => {
    await db.update(schema.users).set({ image: "https://lh3.googleusercontent.com/a/ana", handle: "pruebamiembros_ana" }).where(eq(schema.users.id, ANA));
    const r = await invitar(PROYECTO, DUENO, correo(ANA), "editor");
    if (r.ok) await aceptarInvitacion(r.token, ANA, correo(ANA));
    const { miembros } = await listarMiembros(PROYECTO);
    expect(miembros.find((x) => x.userId === ANA)).toMatchObject({ avatar: "https://lh3.googleusercontent.com/a/ana", handle: "pruebamiembros_ana" });
    await db.update(schema.users).set({ handle: null }).where(eq(schema.users.id, ANA));
  });
});
