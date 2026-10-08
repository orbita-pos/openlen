/**
 * LOS MIEMBROS DE UN PROYECTO: invitarlos, que acepten, quitarlos, cambiarles
 * el rol, y lo que gastan con Len (paga el dueño; el tope lo pone él).
 *
 * Quién entra a qué NO se decide aquí: eso es `lib/projects/acceso.ts`. Esto
 * sólo escribe y lee las filas. Las rutas que lo llaman comprueban antes que
 * quien pide es el dueño.
 */
import "server-only";

import crypto from "node:crypto";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { RolDeMiembro } from "@/lib/projects/acceso";

export const MAX_MIEMBROS = 10;
export const INVITACION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
export const normalizarCorreo = (x: string) => x.trim().toLowerCase();

export interface Miembro {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly rol: RolDeMiembro;
  readonly desde: Date;
  /** Créditos que gastó con Len este mes. */
  readonly gastoDelMes: number;
}

export interface Invitacion {
  readonly email: string;
  readonly rol: RolDeMiembro;
  readonly expira: Date;
}

/** '2026-10': el mes del gasto, en UTC. */
export function mesDe(fecha: Date = new Date()): string {
  return fecha.toISOString().slice(0, 7);
}

export async function listarMiembros(projectId: string): Promise<{ miembros: Miembro[]; invitaciones: Invitacion[] }> {
  const mes = mesDe();
  const filas = await db
    .select({
      userId: schema.projectMembers.userId,
      rol: schema.projectMembers.rol,
      desde: schema.projectMembers.createdAt,
      email: schema.users.email,
      name: schema.users.name,
      gasto: schema.projectMemberSpend.creditos,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .leftJoin(
      schema.projectMemberSpend,
      and(
        eq(schema.projectMemberSpend.projectId, schema.projectMembers.projectId),
        eq(schema.projectMemberSpend.userId, schema.projectMembers.userId),
        eq(schema.projectMemberSpend.mes, mes),
      ),
    )
    .where(eq(schema.projectMembers.projectId, projectId))
    .orderBy(schema.projectMembers.createdAt);
  const invitaciones = await db
    .select({ email: schema.projectInvites.email, rol: schema.projectInvites.rol, expira: schema.projectInvites.expires })
    .from(schema.projectInvites)
    .where(
      and(
        eq(schema.projectInvites.projectId, projectId),
        eq(schema.projectInvites.used, false),
        gt(schema.projectInvites.expires, new Date()),
      ),
    )
    .orderBy(desc(schema.projectInvites.createdAt));
  // Una invitación repetida al mismo correo: vale la última.
  const vistas = new Set<string>();
  return {
    miembros: filas.map((f) => ({ userId: f.userId, email: f.email, name: f.name, rol: f.rol, desde: f.desde, gastoDelMes: f.gasto ?? 0 })),
    invitaciones: invitaciones.filter((i) => !vistas.has(i.email) && vistas.add(i.email)),
  };
}

/** ¿Alguien puede llegar todavía? Una invitación sin usar y sin caducar: el
 *  chat del dueño sigue mirando, porque el invitado acepta con su pestaña abierta. */
export async function hayInvitacionesPendientes(projectId: string): Promise<boolean> {
  const [fila] = await db
    .select({ email: schema.projectInvites.email })
    .from(schema.projectInvites)
    .where(
      and(
        eq(schema.projectInvites.projectId, projectId),
        eq(schema.projectInvites.used, false),
        gt(schema.projectInvites.expires, new Date()),
      ),
    )
    .limit(1);
  return Boolean(fila);
}

export type ResultadoDeInvitar =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly motivo: "tu_mismo" | "ya_es_miembro" | "limite" };

/**
 * Invita a `email` con `rol`: devuelve el token CRUDO (va en el correo; aquí
 * sólo se guarda su sha256). Siempre por enlace —aunque el correo ya tenga
 * cuenta—: el miembro existe cuando acepta, no cuando alguien escribe su correo.
 */
export async function invitar(
  projectId: string,
  duenoId: string,
  email: string,
  rol: RolDeMiembro,
): Promise<ResultadoDeInvitar> {
  const correo = normalizarCorreo(email);
  const [dueno] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, duenoId)).limit(1);
  if (dueno && normalizarCorreo(dueno.email) === correo) return { ok: false, motivo: "tu_mismo" };
  const { miembros, invitaciones } = await listarMiembros(projectId);
  if (miembros.some((m) => normalizarCorreo(m.email) === correo)) return { ok: false, motivo: "ya_es_miembro" };
  const pendiente = invitaciones.some((i) => i.email === correo);
  if (!pendiente && miembros.length + invitaciones.length >= MAX_MIEMBROS) return { ok: false, motivo: "limite" };
  // Una sola invitación viva por correo: la nueva sustituye a la anterior.
  await db
    .delete(schema.projectInvites)
    .where(and(eq(schema.projectInvites.projectId, projectId), eq(schema.projectInvites.email, correo)));
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.projectInvites).values({
    tokenHash: sha256(token),
    projectId,
    email: correo,
    rol,
    invitedBy: duenoId,
    expires: new Date(Date.now() + INVITACION_TTL_MS),
  });
  return { ok: true, token };
}

/**
 * Acepta una invitación: de un solo uso, sin caducar y SÓLO para quien entra
 * con el correo invitado (el correo va dentro del WHERE atómico: con otra
 * cuenta no casa ninguna fila y el enlace NO se quema).
 */
export async function aceptarInvitacion(
  token: string,
  userId: string,
  email: string,
): Promise<{ readonly projectId: string; readonly rol: RolDeMiembro } | null> {
  const filas = await db
    .update(schema.projectInvites)
    .set({ used: true })
    .where(
      and(
        eq(schema.projectInvites.tokenHash, sha256(token)),
        eq(schema.projectInvites.email, normalizarCorreo(email)),
        eq(schema.projectInvites.used, false),
        gt(schema.projectInvites.expires, new Date()),
      ),
    )
    .returning({ projectId: schema.projectInvites.projectId, rol: schema.projectInvites.rol, invitedBy: schema.projectInvites.invitedBy });
  const fila = filas[0];
  if (!fila) return null;
  // El dueño no se hace miembro de lo suyo.
  const [p] = await db.select({ duenoId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, fila.projectId)).limit(1);
  if (!p) return null;
  if (p.duenoId !== userId) {
    await db
      .insert(schema.projectMembers)
      .values({ projectId: fila.projectId, userId, rol: fila.rol, invitedBy: fila.invitedBy })
      .onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.userId], set: { rol: fila.rol } });
  }
  void db
    .delete(schema.projectInvites)
    .where(and(eq(schema.projectInvites.projectId, fila.projectId), lt(schema.projectInvites.expires, new Date())))
    .catch(() => {});
  return { projectId: fila.projectId, rol: fila.rol };
}

export async function quitarMiembro(projectId: string, userId: string): Promise<boolean> {
  const filas = await db
    .delete(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)))
    .returning({ id: schema.projectMembers.id });
  return filas.length > 0;
}

export async function cancelarInvitacion(projectId: string, email: string): Promise<void> {
  await db
    .delete(schema.projectInvites)
    .where(and(eq(schema.projectInvites.projectId, projectId), eq(schema.projectInvites.email, normalizarCorreo(email))));
}

export async function cambiarRol(projectId: string, userId: string, rol: RolDeMiembro): Promise<boolean> {
  const filas = await db
    .update(schema.projectMembers)
    .set({ rol })
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)))
    .returning({ id: schema.projectMembers.id });
  return filas.length > 0;
}

/** Los proyectos donde `userId` es miembro, con su rol y su dueño. */
export async function proyectosCompartidos(
  userId: string,
): Promise<{ readonly projectId: string; readonly rol: RolDeMiembro; readonly duenoEmail: string; readonly duenoName: string | null }[]> {
  const filas = await db
    .select({
      projectId: schema.projectMembers.projectId,
      rol: schema.projectMembers.rol,
      duenoEmail: schema.users.email,
      duenoName: schema.users.name,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.projectMembers.userId, userId));
  return filas;
}

// ── El gasto de los miembros con Len ─────────────────────────────────────────

export async function topeDelProyecto(projectId: string): Promise<number | null> {
  const [p] = await db
    .select({ tope: schema.projects.topeMensualMiembros })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return p?.tope ?? null;
}

export async function ponerTope(projectId: string, tope: number | null): Promise<void> {
  await db.update(schema.projects).set({ topeMensualMiembros: tope }).where(eq(schema.projects.id, projectId));
}

/** Lo que gastaron este mes, entre todos, los miembros del proyecto. */
export async function gastoDeMiembrosDelMes(projectId: string, mes: string = mesDe()): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.projectMemberSpend.creditos}), 0)::int` })
    .from(schema.projectMemberSpend)
    .where(and(eq(schema.projectMemberSpend.projectId, projectId), eq(schema.projectMemberSpend.mes, mes)));
  return Number(r?.total ?? 0);
}

/** Lo que le queda al proyecto este mes para sus miembros (`null` = sin tope). */
export async function margenDeMiembros(projectId: string): Promise<number | null> {
  const tope = await topeDelProyecto(projectId);
  if (tope == null) return null;
  return Math.max(0, tope - (await gastoDeMiembrosDelMes(projectId)));
}

/** ¿Le caben `creditos` más a los miembros este mes? Sin tope, siempre. */
export async function cabeEnElTope(projectId: string, creditos: number): Promise<boolean> {
  const margen = await margenDeMiembros(projectId);
  return margen == null || margen >= Math.max(1, creditos);
}

/** Suma lo que gastó un miembro en un turno. Fail-soft: un fallo aquí no
 *  puede tirar un turno que ya se cobró. */
export async function sumarGasto(projectId: string, userId: string, creditos: number): Promise<void> {
  if (!(creditos > 0)) return;
  const mes = mesDe();
  await db
    .insert(schema.projectMemberSpend)
    .values({ projectId, userId, mes, creditos })
    .onConflictDoUpdate({
      target: [schema.projectMemberSpend.projectId, schema.projectMemberSpend.userId, schema.projectMemberSpend.mes],
      set: { creditos: sql`${schema.projectMemberSpend.creditos} + ${creditos}` },
    })
    .catch((err) => console.error("[miembros] no se pudo sumar el gasto", err));
}

/** Nombres para el historial: id → nombre o correo. */
export async function nombresDe(ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const filas = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(ids)]));
  return Object.fromEntries(filas.map((f) => [f.id, f.name?.trim() || f.email]));
}
