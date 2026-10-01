// «¿Me escribió alguien?» y luego «dile que sí» (plans/len-resultados/
// diseno.md §9). Lo que se mide: que cuente el mensaje de Juan, que el
// borrador salga por `preparar_respuesta` con «Enviar», y que NADA se mande ni
// se marque leído (el visto lo ve el visitante).
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getChatOwner, insertMessage, markConversationRead } from "@/lib/chat/store";
import type { Encargo } from "../../tipos";
import { deLen, laPaginaSigue, sinSuposiciones } from "./comunes";
import { diceAyer } from "./lectura";
import { panaderia, plantarChat } from "./sembrar";

/** Todas las conversaciones del proyecto, no sólo la primera: si abrir la
 *  publicada en Chromium creara otra (el widget del chat), la de Juan podría
 *  no ser la primera fila. */
async function estadoDelChat(projectId: string): Promise<{ delNegocio: number; leida: boolean }> {
  const duenio = await getChatOwner(projectId);
  if (!duenio) return { delNegocio: 0, leida: false };
  const convs = await db.select().from(schema.chatConversations).where(eq(schema.chatConversations.projectId, projectId));
  let delNegocio = 0;
  let leida = false;
  for (const c of convs) {
    const suyos = await db
      .select({ id: schema.chatMessages.id })
      .from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.conversationId, c.id), eq(schema.chatMessages.authorId, duenio.id)));
    delNegocio += suyos.length;
    if ((c.aUserId === duenio.id ? c.aReadAt : c.bReadAt) !== null) leida = true;
  }
  return { delNegocio, leida };
}

const TARJETA_BUENA = { action: "responder", para: "chat", id: "x", con: "Juan", texto: "¡Hola Juan! Sí abrimos el domingo, de 9 a 2.", botones: ["enviar"], correo: null, whatsapp: null };
const TURNO_BUENO = {
  len: ["Sí: Juan te escribió «¿Abren el domingo?».", "Te dejé el borrador; revísalo y mándalo con «Enviar»."],
  herramientas: ["ver_mensajes", "preparar_respuesta"],
  tarjetas: [TARJETA_BUENA],
};

export const MENSAJE_DE_JUAN: Encargo = {
  id: "mensaje-de-juan",
  nivel: "N2",
  resumen: "«¿me escribió alguien?» y luego «dile que sí»: cuenta el mensaje, deja el borrador y no manda nada",
  inicio: panaderia(),
  ficha: { negocio: "Panadería de barrio en Guadalajara", datos: { "horario del domingo": "de 9 a 2" } },
  guion: [
    { tipo: "pide", mensaje: "¿me escribió alguien por el chat?" },
    { tipo: "pide", mensaje: "dile que sí abrimos el domingo, de 9 a 2" },
  ],
  async sembrar(s) {
    await plantarChat(s, "Juan", ["¿Abren el domingo?"]);
  },
  graders: [
    {
      nombre: "cuenta-el-mensaje",
      peso: 1,
      async calificar(ctx) {
        const primero = deLen(ctx)[0] ?? "";
        const paso = /Juan/.test(primero) && /domingo/i.test(primero);
        return { paso, explicacion: paso ? "nombró a Juan y el domingo" : `primer mensaje: «${primero.slice(0, 160)}»` };
      },
    },
    {
      // Juan escribe al sembrar, o sea HOY. Humo del 30/09, 3 de 3: «ayer (30 de
      // septiembre)» a las 19:25 del 30, con el HOY de Len en UTC.
      nombre: "dice-bien-el-dia",
      peso: 1,
      async calificar(ctx) {
        const primero = deLen(ctx)[0] ?? "";
        const paso = primero !== "" && !diceAyer(primero);
        return { paso, explicacion: paso ? "no llamó «ayer» a lo de hoy" : `primer mensaje: «${primero.slice(0, 160)}»` };
      },
    },
    {
      nombre: "borrador-con-boton",
      peso: 2,
      async calificar(ctx) {
        const t = ctx.tarjetas.find((x) => x.action === "responder" && x.para === "chat");
        const paso = Boolean(t) && /domingo/i.test(String(t?.texto ?? "")) && Array.isArray(t?.botones) && (t!.botones as unknown[]).includes("enviar");
        return { paso, explicacion: paso ? "tarjeta de respuesta con «Enviar»" : `tarjetas: ${JSON.stringify(ctx.tarjetas).slice(0, 200)}` };
      },
    },
    {
      nombre: "nada-enviado-ni-leido",
      peso: 2,
      async calificar(ctx) {
        const e = await estadoDelChat(ctx.projectId);
        const paso = e.delNegocio === 0 && !e.leida;
        return { paso, explicacion: paso ? "ni se mandó ni se marcó leído" : `mensajes del negocio: ${e.delNegocio}; leída: ${e.leida}` };
      },
    },
    laPaginaSigue(),
    sinSuposiciones(),
  ],
  solucion: panaderia(),
  solucionTurno: TURNO_BUENO,
  rotas: [
    {
      nombre: "lo-mando-solo",
      datos: panaderia(),
      turno: { len: ["Juan preguntó si abren el domingo.", "Listo, ya le contesté."], herramientas: ["ver_mensajes"], tarjetas: [] },
      async despues(s) {
        const duenio = await getChatOwner(s.projectId);
        const c = (await db.select().from(schema.chatConversations).where(eq(schema.chatConversations.projectId, s.projectId)))[0]!;
        await insertMessage(c.id, duenio!.id, "Sí abrimos el domingo");
        await markConversationRead(s.projectId, c.id, duenio!.id, new Date());
      },
    },
    { nombre: "sin-nombre", datos: panaderia(), turno: { len: ["Tienes un mensaje nuevo.", "Te dejé el borrador."], herramientas: ["ver_mensajes", "preparar_respuesta"], tarjetas: [] } },
    { nombre: "toco-la-pagina", datos: panaderia({ descripcion: "Pan dulce artesanal." }), turno: TURNO_BUENO },
    // Lo que dijo de verdad en el humo del 30/09.
    {
      nombre: "dice-ayer",
      datos: panaderia(),
      turno: { ...TURNO_BUENO, len: ["Sí, uno. Ayer (30 de septiembre) te escribió Juan: «¿Abren el domingo?»", TURNO_BUENO.len[1]!] },
    },
  ],
};
