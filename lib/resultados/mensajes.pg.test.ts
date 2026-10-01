// @vitest-environment node
// Los mensajes del chat: sin leer como el globito, y leer NO marca. Base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { createGuestChatUser, getOrCreateConversation, getOrCreateOwnerChatUser, insertMessage, markConversationRead } from "@/lib/chat/store";
import { leerConversacion, resumirMensajes } from "./mensajes";

const USUARIO = "prueba-mensajes-user";
const PROYECTO = "prueba-mensajes-proyecto";
const MX = "America/Mexico_City";
// 30/09 19:00 en México = 01/10 01:00 UTC: el día de UTC ya cambió.
const ULTIMO = new Date("2026-10-01T01:00:00Z");
let conversacion = "";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USUARIO, email: `${USUARIO}@ejemplo.invalido` }).onConflictDoNothing();
  await db.insert(schema.projects).values({
    id: PROYECTO, userId: USUARIO, title: "Panadería", brief: "mensajes",
    data: { html: "<!doctype html><html><body></body></html>", settings: { chat: { enabled: true } } },
  }).onConflictDoNothing();
  const duenio = await getOrCreateOwnerChatUser(PROYECTO, USUARIO, { displayName: "Panadería" });
  const juan = await createGuestChatUser(PROYECTO, { displayName: "Juan" });
  conversacion = (await getOrCreateConversation(PROYECTO, juan.id, duenio.id)).id;
  await insertMessage(conversacion, juan.id, "¿Abren el domingo?");
  // `createdAt` va al milisegundo: sin esta pausa los dos pueden empatar y el
  // «último» saldría al azar.
  await new Promise((r) => setTimeout(r, 15));
  await insertMessage(conversacion, juan.id, "Es para un pastel");
  // La fecha de la conversación, fija y en el corte: así se ve si el día sale
  // en la hora del usuario o en la de la máquina que corre esto.
  await db.update(schema.chatConversations).set({ lastMessageAt: ULTIMO }).where(eq(schema.chatConversations.id, conversacion));
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
});

describe("resumirMensajes", () => {
  it("cuenta lo que el visitante escribió después de la última lectura del negocio", async () => {
    const r = await resumirMensajes(PROYECTO, MX, { cuales: "sin_leer" });
    expect(r).toMatchObject({ hayChat: true, conversacionesSinLeer: 1, mensajesSinLeer: 2, conversaciones: 1 });
    expect(r.lista[0]).toMatchObject({ id: conversacion, con: "Juan", ultimo: "Es para un pastel", sinLeer: 2 });
  });
  it("la fecha es el día del USUARIO, no el de UTC ni el de la máquina", async () => {
    const r = await resumirMensajes(PROYECTO, MX, { cuales: "sin_leer" });
    expect(r.lista[0]!.fecha).toBe("2026-09-30");
    const porFecha = await resumirMensajes(PROYECTO, MX, { cuales: "fecha", desde: "2026-09-30", hasta: "2026-09-30" });
    expect(porFecha.lista.map((c) => c.id)).toEqual([conversacion]);
  });
});

describe("leerConversacion", () => {
  it("devuelve los mensajes y NO marca leído", async () => {
    const c = await leerConversacion(PROYECTO, MX, conversacion);
    expect(c?.mensajes.map((m) => [m.de, m.texto])).toEqual([["visitante", "¿Abren el domingo?"], ["visitante", "Es para un pastel"]]);
    expect((await resumirMensajes(PROYECTO, MX, { cuales: "sin_leer" })).mensajesSinLeer).toBe(2);
  });
  it("una conversación de otro proyecto no existe", async () => {
    expect(await leerConversacion("otro-proyecto", MX, conversacion)).toBeNull();
  });
});

// Lo que hace la bandeja al contestar (app/api/inbox/[conversationId]/reply):
// el negocio escribe y la conversación queda leída. Va AL FINAL: cambia el estado.
describe("contestar deja la conversación leída", () => {
  it("tras el mensaje del negocio y su lectura, no queda nada sin leer", async () => {
    const duenio = await getOrCreateOwnerChatUser(PROYECTO, USUARIO, { displayName: "Panadería" });
    await insertMessage(conversacion, duenio.id, "Sí, abrimos el domingo");
    await markConversationRead(PROYECTO, conversacion, duenio.id, new Date());
    const r = await resumirMensajes(PROYECTO, MX, { cuales: "sin_leer" });
    expect(r).toMatchObject({ mensajesSinLeer: 0, conversacionesSinLeer: 0, conversaciones: 1 });
    expect((await leerConversacion(PROYECTO, MX, conversacion))?.mensajes.at(-1)).toMatchObject({ de: "negocio" });
  });
});
