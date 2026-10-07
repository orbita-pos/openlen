/**
 * LOS HILOS EN EL CÓDIGO: un comentario con menciones sobre una línea de un
 * fichero (como Claude Tag, pero en la lente «Código»).
 *
 *   · `@Len` — el cliente le pide el cambio en un turno (con `hiloId`), y al
 *     cerrar el turno la ruta de Len contesta EN EL HILO (`respuestaDeLen`).
 *   · `@persona` — alguien del proyecto (el dueño o un miembro): le llega un
 *     aviso (push y correo, `lib/notifications`) y el hilo se le marca sin ver.
 *
 * Quién puede qué lo deciden las rutas con `lib/projects/acceso.ts`: comentar
 * y mencionar a personas, cualquiera que vea el proyecto (un lector también:
 * comentar no es editar); `@Len`, sólo quien puede editar. Aquí sólo se leen y
 * escriben las filas, y se valida que las menciones sean gente del proyecto.
 */
import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export const MAX_TEXTO_DEL_HILO = 4000;
export const MAX_CODIGO_DEL_HILO = 400;

export interface Persona {
  readonly userId: string;
  readonly nombre: string;
  readonly email: string;
  readonly rol: "dueno" | "editor" | "lector";
}

export interface MensajeDelHilo {
  readonly id: string;
  /** `null` = Len. */
  readonly autorId: string | null;
  readonly autor: string | null;
  readonly texto: string;
  readonly filaId: string | null;
  readonly createdAt: Date;
}

export interface Hilo {
  readonly id: string;
  readonly ruta: string;
  readonly linea: number;
  readonly codigo: string;
  readonly estado: "abierto" | "resuelto";
  readonly creadoPor: string;
  readonly createdAt: Date;
  readonly mensajes: readonly MensajeDelHilo[];
  /** Menciones a quien pide que aún no vio. */
  readonly sinVer: number;
}

const nombreDe = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

/** El dueño y los miembros: a quién se puede mencionar. */
export async function personasDelProyecto(projectId: string): Promise<Persona[]> {
  const [dueno] = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!dueno) return [];
  const miembros = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, rol: schema.projectMembers.rol })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, projectId))
    .orderBy(asc(schema.projectMembers.createdAt));
  return [
    { userId: dueno.id, nombre: nombreDe(dueno), email: dueno.email, rol: "dueno" },
    ...miembros.map((m) => ({ userId: m.id, nombre: nombreDe(m), email: m.email, rol: m.rol })),
  ];
}

export async function listarHilos(projectId: string, quien: string, ruta?: string | null): Promise<Hilo[]> {
  const hilos = await db
    .select()
    .from(schema.codeThreads)
    .where(and(eq(schema.codeThreads.projectId, projectId), ruta ? eq(schema.codeThreads.ruta, ruta) : undefined))
    .orderBy(asc(schema.codeThreads.ruta), asc(schema.codeThreads.linea), asc(schema.codeThreads.createdAt))
    .limit(500);
  if (hilos.length === 0) return [];
  const ids = hilos.map((h) => h.id);
  const mensajes = await db
    .select({
      id: schema.codeThreadMessages.id,
      threadId: schema.codeThreadMessages.threadId,
      autorId: schema.codeThreadMessages.autorId,
      texto: schema.codeThreadMessages.texto,
      filaId: schema.codeThreadMessages.filaId,
      createdAt: schema.codeThreadMessages.createdAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.codeThreadMessages)
    .leftJoin(schema.users, eq(schema.users.id, schema.codeThreadMessages.autorId))
    .where(inArray(schema.codeThreadMessages.threadId, ids))
    .orderBy(asc(schema.codeThreadMessages.createdAt));
  const sinVer = await db
    .select({ threadId: schema.codeMentions.threadId, n: sql<number>`count(*)::int` })
    .from(schema.codeMentions)
    .where(and(inArray(schema.codeMentions.threadId, ids), eq(schema.codeMentions.userId, quien), isNull(schema.codeMentions.vistaAt)))
    .groupBy(schema.codeMentions.threadId);
  const porHilo = new Map<string, MensajeDelHilo[]>();
  for (const m of mensajes) {
    const lista = porHilo.get(m.threadId) ?? [];
    lista.push({
      id: m.id,
      autorId: m.autorId,
      autor: m.autorId ? (m.email ? nombreDe({ name: m.name, email: m.email }) : null) : null,
      texto: m.texto,
      filaId: m.filaId,
      createdAt: m.createdAt,
    });
    porHilo.set(m.threadId, lista);
  }
  const sinVerDe = new Map(sinVer.map((s) => [s.threadId, Number(s.n)]));
  return hilos.map((h) => ({
    id: h.id,
    ruta: h.ruta,
    linea: h.linea,
    codigo: h.codigo,
    estado: h.estado,
    creadoPor: h.creadoPor,
    createdAt: h.createdAt,
    mensajes: porHilo.get(h.id) ?? [],
    sinVer: sinVerDe.get(h.id) ?? 0,
  }));
}

/** Las menciones válidas: gente del proyecto, sin repetir y sin quien escribe. */
export function mencionesValidas(pedidas: readonly string[], personas: readonly Persona[], autorId: string): string[] {
  const del = new Set(personas.map((p) => p.userId));
  return [...new Set(pedidas)].filter((id) => del.has(id) && id !== autorId);
}

export interface Escrito {
  readonly hiloId: string;
  readonly mensajeId: string;
  readonly mencionados: readonly string[];
}

async function escribirMensaje(
  projectId: string,
  hiloId: string,
  autorId: string,
  texto: string,
  menciones: readonly string[],
): Promise<Escrito> {
  const personas = await personasDelProyecto(projectId);
  const mencionados = mencionesValidas(menciones, personas, autorId);
  const [m] = await db
    .insert(schema.codeThreadMessages)
    .values({ threadId: hiloId, autorId, texto: texto.slice(0, MAX_TEXTO_DEL_HILO) })
    .returning({ id: schema.codeThreadMessages.id });
  if (mencionados.length > 0) {
    await db
      .insert(schema.codeMentions)
      .values(mencionados.map((userId) => ({ projectId, threadId: hiloId, messageId: m!.id, userId })));
  }
  await db.update(schema.codeThreads).set({ updatedAt: new Date() }).where(eq(schema.codeThreads.id, hiloId));
  return { hiloId, mensajeId: m!.id, mencionados };
}

export async function crearHilo(p: {
  projectId: string;
  autorId: string;
  ruta: string;
  linea: number;
  codigo: string;
  texto: string;
  menciones: readonly string[];
}): Promise<Escrito> {
  const [h] = await db
    .insert(schema.codeThreads)
    .values({
      projectId: p.projectId,
      ruta: p.ruta,
      linea: p.linea,
      codigo: p.codigo.slice(0, MAX_CODIGO_DEL_HILO),
      creadoPor: p.autorId,
    })
    .returning({ id: schema.codeThreads.id });
  return escribirMensaje(p.projectId, h!.id, p.autorId, p.texto, p.menciones);
}

/** `null` si el hilo no es de ese proyecto. Contestar un hilo resuelto lo reabre. */
export async function responderHilo(p: {
  projectId: string;
  hiloId: string;
  autorId: string;
  texto: string;
  menciones: readonly string[];
}): Promise<Escrito | null> {
  const hilo = await hiloDelProyecto(p.projectId, p.hiloId);
  if (!hilo) return null;
  if (hilo.estado === "resuelto") await cambiarEstado(p.projectId, p.hiloId, "abierto");
  return escribirMensaje(p.projectId, p.hiloId, p.autorId, p.texto, p.menciones);
}

/** Lo que contesta Len al cerrar el turno que se le pidió desde el hilo. */
export async function respuestaDeLen(p: { projectId: string; hiloId: string; texto: string; filaId: string | null }): Promise<boolean> {
  const hilo = await hiloDelProyecto(p.projectId, p.hiloId);
  if (!hilo) return false;
  const texto = p.texto.trim();
  if (!texto) return false;
  await db.insert(schema.codeThreadMessages).values({ threadId: p.hiloId, autorId: null, texto: texto.slice(0, MAX_TEXTO_DEL_HILO), filaId: p.filaId });
  await db.update(schema.codeThreads).set({ updatedAt: new Date() }).where(eq(schema.codeThreads.id, p.hiloId));
  return true;
}

export async function hiloDelProyecto(projectId: string, hiloId: string) {
  const [h] = await db
    .select({ id: schema.codeThreads.id, estado: schema.codeThreads.estado, ruta: schema.codeThreads.ruta, linea: schema.codeThreads.linea })
    .from(schema.codeThreads)
    .where(and(eq(schema.codeThreads.id, hiloId), eq(schema.codeThreads.projectId, projectId)))
    .limit(1);
  return h ?? null;
}

export async function cambiarEstado(projectId: string, hiloId: string, estado: "abierto" | "resuelto"): Promise<boolean> {
  const filas = await db
    .update(schema.codeThreads)
    .set({ estado, updatedAt: new Date() })
    .where(and(eq(schema.codeThreads.id, hiloId), eq(schema.codeThreads.projectId, projectId)))
    .returning({ id: schema.codeThreads.id });
  return filas.length > 0;
}

/** Quien abrió estos hilos ya vio sus menciones en ellos. */
export async function marcarVistas(projectId: string, userId: string, hiloIds: readonly string[]): Promise<void> {
  if (hiloIds.length === 0) return;
  await db
    .update(schema.codeMentions)
    .set({ vistaAt: new Date() })
    .where(
      and(
        eq(schema.codeMentions.projectId, projectId),
        eq(schema.codeMentions.userId, userId),
        inArray(schema.codeMentions.threadId, [...hiloIds]),
        isNull(schema.codeMentions.vistaAt),
      ),
    );
}

/** Cuántas menciones sin ver tiene `userId` en el proyecto, y en qué ficheros. */
export async function mencionesSinVer(projectId: string, userId: string): Promise<{ total: number; rutas: string[] }> {
  const filas = await db
    .select({ ruta: schema.codeThreads.ruta })
    .from(schema.codeMentions)
    .innerJoin(schema.codeThreads, eq(schema.codeThreads.id, schema.codeMentions.threadId))
    .where(and(eq(schema.codeMentions.projectId, projectId), eq(schema.codeMentions.userId, userId), isNull(schema.codeMentions.vistaAt)));
  return { total: filas.length, rutas: [...new Set(filas.map((f) => f.ruta))].sort() };
}
