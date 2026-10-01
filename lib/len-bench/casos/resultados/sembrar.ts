// Ayudantes para plantar resultados en la base LOCAL, en la hora del dueño
// (plans/len-resultados/). Los días y las horas salen de `./hora`, que es puro.
import { db, schema } from "@/lib/db";
import { createGuestChatUser, getOrCreateConversation, getOrCreateOwnerChatUser, insertMessage } from "@/lib/chat/store";
import type { ProjectData } from "@/lib/projects/types";
import type { Siembra } from "../../tipos";

export { aLas, haceUnRato } from "./hora";

export const NOMBRE = "Panadería La Espiga";
export const DESCRIPCION = "Pan dulce y pasteles por encargo en Guadalajara.";
export const TELEFONO = "33 8765 4321";

export async function plantarVistas(projectId: string, n: number, ts: Date, prefijo: string): Promise<void> {
  if (n === 0) return;
  await db.insert(schema.pageEvents).values(
    Array.from({ length: n }, (_, i) => ({ projectId, type: "view", ts, uaHash: `${prefijo}-${i}`, device: "mobile" })),
  );
}

/** El id lleva el proyecto delante: dos corridas no chocan por clave primaria. */
export async function plantarFormulario(projectId: string, id: string, datos: Record<string, string>, createdAt: Date, seenAt: Date | null): Promise<void> {
  await db.insert(schema.formSubmissions).values({ id: `${projectId}-${id}`, projectId, data: datos, createdAt, seenAt });
}

export async function plantarChat(s: Siembra, visitante: string, mensajes: readonly string[]): Promise<string> {
  const duenio = await getOrCreateOwnerChatUser(s.projectId, s.ownerId, { displayName: NOMBRE });
  const quien = await createGuestChatUser(s.projectId, { displayName: visitante });
  const c = await getOrCreateConversation(s.projectId, quien.id, duenio.id);
  for (const m of mensajes) await insertMessage(c.id, quien.id, m);
  return c.id;
}

/** El horario de la panadería de mensaje-de-juan-con-horario: la del domingo es
 *  la respuesta a Juan. */
export const HORARIO = "Lunes a sábado de 8 a 8. Domingo de 9 a 2.";

/** La página de partida de los casos: una panadería con su teléfono y el chat
 *  encendido. `descripcion` existe para las rotas que tocan lo que nadie pidió;
 *  `horario`, para el caso en que la página SÍ lo tiene. */
export function panaderia(o: { telefono?: string; descripcion?: string; horario?: string } = {}): ProjectData {
  const telefono = o.telefono ?? TELEFONO;
  const descripcion = o.descripcion ?? DESCRIPCION;
  const horario = o.horario ? `<section id="horario"><h2>Horario</h2><p>${o.horario}</p></section>` : "";
  return {
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${NOMBRE}</title></head><body><header><h1>${NOMBRE}</h1></header><main><p>${descripcion}</p><p>Teléfono: <a href="tel:${telefono.replace(/\s/g, "")}">${telefono}</a></p>${horario}</main></body></html>`,
    settings: { chat: { enabled: true } },
  } as ProjectData;
}
