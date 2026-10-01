/**
 * LOS MENSAJES DEL CHAT DE LA PÁGINA (plans/len-resultados/diseno.md §4, §6).
 *
 * «Sin leer» es lo que el VISITANTE escribió después de la última lectura del
 * negocio: la misma semántica que `countUnreadChat` (lib/inbox/badge.ts).
 * 🔴 Aquí NADA marca como leído: el visto lo ve el visitante
 * (app/api/chat/[sub]/messages/route.ts), y que Len te cuente un mensaje no
 * es que tú lo hayas abierto. Como en WhatsApp.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getChatOwner } from "@/lib/chat/store";
import { fechaLocal, restarDias } from "./zona";

export type FiltroDeMensajes = { cuales: "sin_leer" } | { cuales: "fecha"; desde?: string; hasta?: string };
export interface ConversacionEnLista { id: string; con: string; ultimo: string; fecha: string | null; sinLeer: number }
export interface ResumenDeMensajes {
  zona: string;
  hayChat: boolean;
  conversacionesSinLeer: number;
  mensajesSinLeer: number;
  conversaciones: number;
  lista: ConversacionEnLista[];
}
export interface ConversacionAbierta { id: string; con: string; mensajes: { de: "visitante" | "negocio"; texto: string; fecha: string }[] }

const LIMITE = 50;
const ULTIMOS = 30;
const recortar = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max)}…` : s);

export async function resumirMensajes(
  projectId: string,
  zona: string,
  filtro: FiltroDeMensajes,
  ahora: Date = new Date(),
): Promise<ResumenDeMensajes> {
  const duenio = await getChatOwner(projectId);
  const vacio = { zona, hayChat: false, conversacionesSinLeer: 0, mensajesSinLeer: 0, conversaciones: 0, lista: [] };
  if (!duenio) return vacio;
  const o = duenio.id;
  // EL DÍA SALE YA HECHO DE POSTGRES. En SQL crudo un `timestamp` sin zona
  // llega como TEXTO («2026-10-01 01:00:00»), y `new Date(texto)` lo lee en la
  // hora de la MÁQUINA: en esta de desarrollo (America/Mazatlan) eran 7 horas
  // de desfase y un mensaje de las 19:00 de México salía con fecha de mañana.
  // Medido el 30/09; la prueba lo fija con una conversación en el corte.
  const res = await db.execute(sql`
    SELECT c."id",
      TO_CHAR((c."lastMessageAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zona}, 'YYYY-MM-DD') AS "dia",
      COALESCE(u."displayName", u."username") AS "con",
      (SELECT m."body" FROM "chatMessages" m WHERE m."conversationId" = c."id" ORDER BY m."createdAt" DESC LIMIT 1) AS "ultimo",
      (SELECT count(*)::int FROM "chatMessages" m
         WHERE m."conversationId" = c."id" AND m."authorId" <> ${o}
           AND m."createdAt" > COALESCE(CASE WHEN c."aUserId" = ${o} THEN c."aReadAt" ELSE c."bReadAt" END, '-infinity'::timestamp)
      ) AS "sinLeer"
    FROM "chatConversations" c
    JOIN "chatUsers" u ON u."id" = CASE WHEN c."aUserId" = ${o} THEN c."bUserId" ELSE c."aUserId" END
    WHERE c."projectId" = ${projectId} AND (c."aUserId" = ${o} OR c."bUserId" = ${o})
    ORDER BY c."lastMessageAt" DESC NULLS LAST
  `);
  const todas = (res.rows as { id: string; dia: string | null; con: string; ultimo: string | null; sinLeer: number }[]).map((r) => ({
    id: r.id,
    con: r.con,
    ultimo: recortar(r.ultimo ?? ""),
    dia: r.dia,
    sinLeer: Number(r.sinLeer),
  }));
  const hoy = fechaLocal(ahora, zona);
  const elegidas =
    filtro.cuales === "sin_leer"
      ? todas.filter((c) => c.sinLeer > 0)
      : todas.filter((c) => c.dia !== null && c.dia >= (filtro.desde ?? restarDias(hoy, 6)) && c.dia <= (filtro.hasta ?? hoy));
  return {
    zona,
    hayChat: true,
    conversacionesSinLeer: todas.filter((c) => c.sinLeer > 0).length,
    mensajesSinLeer: todas.reduce((s, c) => s + c.sinLeer, 0),
    conversaciones: todas.length,
    lista: elegidas.slice(0, LIMITE).map((c) => ({
      id: c.id, con: c.con, ultimo: c.ultimo, fecha: c.dia, sinLeer: c.sinLeer,
    })),
  };
}

export async function leerConversacion(projectId: string, zona: string, id: string): Promise<ConversacionAbierta | null> {
  const duenio = await getChatOwner(projectId);
  if (!duenio) return null;
  const conv = await db
    .select({ id: schema.chatConversations.id, a: schema.chatConversations.aUserId, b: schema.chatConversations.bUserId })
    .from(schema.chatConversations)
    .where(and(eq(schema.chatConversations.id, id), eq(schema.chatConversations.projectId, projectId)))
    .limit(1);
  const c = conv[0];
  if (!c) return null;
  const otro = c.a === duenio.id ? c.b : c.a;
  const u = await db
    .select({ nombre: sql<string>`COALESCE(${schema.chatUsers.displayName}, ${schema.chatUsers.username})` })
    .from(schema.chatUsers)
    .where(eq(schema.chatUsers.id, otro))
    .limit(1);
  const filas = await db
    .select({ autor: schema.chatMessages.authorId, texto: schema.chatMessages.body, fecha: schema.chatMessages.createdAt })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.conversationId, id))
    .orderBy(asc(schema.chatMessages.createdAt));
  return {
    id,
    con: u[0]?.nombre ?? "?",
    mensajes: filas.slice(-ULTIMOS).map((m) => ({
      de: m.autor === duenio.id ? "negocio" : "visitante",
      texto: m.texto,
      fecha: fechaLocal(m.fecha, zona),
    })),
  };
}
