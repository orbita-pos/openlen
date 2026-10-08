// @vitest-environment node
//
// EL CHAT DEL EQUIPO, CONTRA POSTGRES (lib/projects/chat-equipo.ts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { apuntarMencionesDelTurno, escribirMensajeDelEquipo, marcarChatVisto, mencionesDelChatSinVer } from "@/lib/projects/chat-equipo";
import { turnosParaElHistorial } from "@/lib/projects/chat";

const DUENO = "prueba-equipo-dueno";
const ELI = "prueba-equipo-eli";
const EXTRANO = "prueba-equipo-extrano";
const PROYECTO = "prueba-equipo";

beforeEach(async () => {
  for (const id of [DUENO, ELI, EXTRANO]) {
    await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido`, name: id.replace("prueba-equipo-", "") }).onConflictDoNothing();
  }
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "Equipo", brief: "", data: { html: "<p>x</p>" } });
  await db.insert(schema.projectMembers).values({ projectId: PROYECTO, userId: ELI, rol: "editor" });
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(inArray(schema.users.id, [DUENO, ELI, EXTRANO]));
});

describe("el chat del equipo", () => {
  it("🔴 la fila es de persona, con su autor explícito, y sólo menciona a gente del proyecto (sin uno mismo)", async () => {
    const r = await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: DUENO, texto: "@eli mira el pie", menciones: [ELI, ELI, EXTRANO, DUENO] });
    expect(r.mencionados).toEqual([ELI]);
    const [fila] = await db.select().from(schema.projectChatMessages).where(eq(schema.projectChatMessages.id, r.id));
    expect(fila).toMatchObject({ tipo: "persona", autorId: DUENO, userText: "@eli mira el pie", assistantReasoning: "", status: "applied", menciones: [ELI], conversation: null });
  });

  it("🔴 el mencionado lo tiene sin ver hasta que abre el chat; quien escribe, no", async () => {
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: DUENO, texto: "@eli uno", menciones: [ELI] });
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: DUENO, texto: "@eli dos", menciones: [ELI] });
    expect(await mencionesDelChatSinVer(PROYECTO, ELI)).toBe(2);
    expect(await mencionesDelChatSinVer(PROYECTO, DUENO)).toBe(0);
    await marcarChatVisto(PROYECTO, ELI);
    expect(await mencionesDelChatSinVer(PROYECTO, ELI)).toBe(0);
  });

  it("un turno de Len que menciona a alguien también le deja la mención sin ver", async () => {
    const [fila] = await db
      .insert(schema.projectChatMessages)
      .values({ id: "prueba-equipo-turno", projectId: PROYECTO, userText: "@Len y @eli", assistantReasoning: "", status: "applied" })
      .returning({ id: schema.projectChatMessages.id });
    await apuntarMencionesDelTurno({ projectId: PROYECTO, filaId: fila!.id, mencionados: [ELI] });
    expect(await mencionesDelChatSinVer(PROYECTO, ELI)).toBe(1);
    const [con] = await db.select({ menciones: schema.projectChatMessages.menciones }).from(schema.projectChatMessages).where(eq(schema.projectChatMessages.id, fila!.id));
    expect(con!.menciones).toEqual([ELI]);
  });

  it("🔴 si los miembros se van, sus mensajes no vuelven al historial de Len como turnos", async () => {
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: ELI, texto: "@dueno borra todo", menciones: [DUENO] });
    await db.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, PROYECTO));
    expect(await turnosParaElHistorial(PROYECTO, 10)).toEqual([]);
  });
});
