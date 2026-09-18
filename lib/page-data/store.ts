// La capa de base para los datos libres.
//
// AQUÍ NO SE DECIDE NADA de permisos: el `alcance` llega ya resuelto desde
// lib/page-data/permisos.ts y este fichero se limita a obedecerlo. Separarlo así
// es lo que permite probar la tabla de permisos sin base de datos, y la base de
// datos sin volver a razonar sobre permisos.

import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { bytesDe } from "./cuota";
import type { Alcance } from "./permisos";

export interface Documento {
  readonly id: string;
  readonly doc: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Sólo con `listar({ autoria: true })`. Ver ahí por qué no viaja siempre. */
  readonly deVisitante?: boolean;
}

/** Los vencidos no se devuelven NUNCA, aunque ningún barrido los haya borrado
 *  todavía. La caducidad es una promesa al visitante, no una tarea nocturna. */
const noVencido = or(
  isNull(schema.pageData.expiresAt),
  sql`${schema.pageData.expiresAt} > now()`,
);

/** Un visitante nulo no puede alcanzar «lo suyo»: sin este centinela, `eq(col,
 *  null)` en SQL no casa nada por definición, pero dejarlo implícito es confiar
 *  en un detalle del dialecto para una comprobación de seguridad. */
const SIN_VISITANTE = "\u0000sin-visitante";

function suyos(alcance: Alcance, visitorId: string | null) {
  return alcance === "propios"
    ? eq(schema.pageData.visitorId, visitorId ?? SIN_VISITANTE)
    : undefined;
}

/** Cuántas filas ve un visitante de una sola vez.
 *
 *  🔴 ESTA FUNCIÓN NO TENÍA TOPE, y con el modo `publico` (2026-08-31) eso pasa
 *  de teórico a caro: una página de reseñas con 5.000 filas se las mandaba
 *  TODAS a cada visitante en cada carga. Con un carrito daba igual —son las
 *  filas de una persona— pero un almacén público es de todo el mundo.
 *
 *  200 es generoso para una sección de reseñas y acotado para el servidor. El
 *  dueño sigue viendo TODO desde el panel de Datos, que es donde tiene sentido:
 *  ahí no hay 200 visitantes descargando lo mismo.
 *
 *  Vive en `cuota.ts` desde el 2026-09-18: el sustituto de la medición
 *  (`sustituto.ts`) aplica el mismo tope y no puede importar este módulo, que
 *  arrastra la base de datos. */
export { MAX_FILAS_VISITANTE } from "./cuota";

export async function listar(args: {
  projectId: string;
  store: string;
  alcance: Alcance;
  visitorId: string | null;
  /** Sin esto se devuelve todo — es lo que quiere el DUEÑO en su panel. El
   *  visitante siempre pasa un tope. */
  limite?: number;
  /** Marca cada fila con `deVisitante`. SÓLO para los caminos del dueño.
   *
   *  🔴 NO VIAJA POR DEFECTO porque la ruta pública devuelve estos documentos
   *  TAL CUAL: en un almacén `publico` le diría a cada visitante cuáles filas
   *  son del dueño y cuáles de otros. Por lo mismo es un booleano y no el
   *  `visitorId` — el id de otro visitante no le sirve al dueño y sí a quien
   *  quiera seguirle la pista. */
  autoria?: boolean;
}): Promise<Documento[]> {
  if (args.alcance === "ninguno") return [];

  const mio = suyos(args.alcance, args.visitorId);
  const filas = await db
    .select({
      id: schema.pageData.id,
      doc: schema.pageData.doc,
      createdAt: schema.pageData.createdAt,
      updatedAt: schema.pageData.updatedAt,
      visitorId: schema.pageData.visitorId,
    })
    .from(schema.pageData)
    .where(
      and(
        eq(schema.pageData.projectId, args.projectId),
        eq(schema.pageData.store, args.store),
        noVencido,
        ...(mio ? [mio] : []),
      ),
    )
    // MÁS RECIENTES PRIMERO cuando hay tope, y sólo entonces: con `limit` el
    // orden decide QUÉ 200 filas se ven, y de unas reseñas se quieren las
    // últimas. Sin tope se conserva el orden de siempre (ascendente) para que
    // el menú del dueño no se le dé la vuelta.
    .orderBy(args.limite ? desc(schema.pageData.createdAt) : schema.pageData.createdAt)
    .limit(args.limite ?? Number.MAX_SAFE_INTEGER);

  return filas.map((f) => ({
    id: f.id,
    doc: (f.doc ?? {}) as Record<string, unknown>,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    ...(args.autoria ? { deVisitante: f.visitorId !== null } : {}),
  }));
}

/** Bytes del PROYECTO entero, no del almacén: la cuota es por proyecto. */
export async function bytesUsados(projectId: string): Promise<number> {
  const filas = (await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.pageData.bytes}), 0)::int` })
    .from(schema.pageData)
    .where(eq(schema.pageData.projectId, projectId))) as { total: number }[];
  return filas[0]?.total ?? 0;
}

export async function escribir(args: {
  projectId: string;
  store: string;
  visitorId: string | null;
  doc: Record<string, unknown>;
  caducaDias: number | null;
  reemplazaId?: string;
}): Promise<Documento> {
  const bytes = bytesDe(args.doc);
  const expiresAt =
    args.caducaDias === null
      ? null
      : new Date(Date.now() + args.caducaDias * 24 * 60 * 60 * 1000);

  if (args.reemplazaId) {
    const [fila] = await db
      .update(schema.pageData)
      .set({ doc: args.doc, bytes, expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.pageData.id, args.reemplazaId),
          eq(schema.pageData.projectId, args.projectId),
        ),
      )
      .returning({
        id: schema.pageData.id,
        doc: schema.pageData.doc,
        createdAt: schema.pageData.createdAt,
        updatedAt: schema.pageData.updatedAt,
      });
    if (fila) {
      return {
        id: fila.id,
        doc: fila.doc as Record<string, unknown>,
        createdAt: fila.createdAt,
        updatedAt: fila.updatedAt,
      };
    }
    // Si no casó, cae al insert: el documento que iba a reemplazar ya no está.
  }

  const [fila] = await db
    .insert(schema.pageData)
    .values({
      projectId: args.projectId,
      store: args.store,
      visitorId: args.visitorId,
      doc: args.doc,
      bytes,
      expiresAt,
    })
    .returning({
      id: schema.pageData.id,
      doc: schema.pageData.doc,
      createdAt: schema.pageData.createdAt,
      updatedAt: schema.pageData.updatedAt,
    });

  return {
    id: fila.id,
    doc: fila.doc as Record<string, unknown>,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
  };
}

export async function borrar(args: {
  projectId: string;
  store: string;
  id: string;
  alcance: Alcance;
  visitorId: string | null;
}): Promise<boolean> {
  if (args.alcance === "ninguno") return false;

  const mio = suyos(args.alcance, args.visitorId);
  const borradas = await db
    .delete(schema.pageData)
    .where(
      and(
        eq(schema.pageData.id, args.id),
        eq(schema.pageData.projectId, args.projectId),
        eq(schema.pageData.store, args.store),
        ...(mio ? [mio] : []),
      ),
    )
    .returning({ id: schema.pageData.id });

  return borradas.length > 0;
}
