// @vitest-environment node
//
// EL CHAT DEL EQUIPO, CONTRA POSTGRES (lib/projects/chat-equipo.ts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { apuntarMencionesDelTurno, escribirMensajeDelEquipo, firmaDelChat, marcarChatVisto, mencionesDelChatSinVer } from "@/lib/projects/chat-equipo";
import { getChatMessages, turnosParaElHistorial } from "@/lib/projects/chat";

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

  it("🔴 la firma del chat cambia con un mensaje nuevo y cuando un turno termina; sin cambios, igual", async () => {
    const vacia = await firmaDelChat(PROYECTO);
    expect(await firmaDelChat(PROYECTO)).toBe(vacia);
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: ELI, texto: "@dueno hola", menciones: [DUENO] });
    const conUno = await firmaDelChat(PROYECTO);
    expect(conUno).not.toBe(vacia);
    await db.insert(schema.projectChatMessages).values({ id: "prueba-equipo-curso", projectId: PROYECTO, userText: "@Len x", assistantReasoning: "", status: "en_curso" });
    const enCurso = await firmaDelChat(PROYECTO);
    expect(enCurso).not.toBe(conUno);
    await db.update(schema.projectChatMessages).set({ status: "applied" }).where(eq(schema.projectChatMessages.id, "prueba-equipo-curso"));
    expect(await firmaDelChat(PROYECTO)).not.toBe(enCurso);
  });

  it("🔴 el chat carga el mensaje del equipo como tal, con su autor y sus menciones", async () => {
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: ELI, texto: "@dueno mira", menciones: [DUENO] });
    const turnos = await getChatMessages(PROYECTO);
    expect(turnos.at(-1)).toMatchObject({ tipo: "persona", autorId: ELI, menciones: [DUENO], userText: "@dueno mira" });
  });

  it("🔴 C1 · con la charla ya en 50 filas, el mensaje nuevo del equipo sale en el chat (se poda la más vieja)", async () => {
    const base = Date.UTC(2026, 9, 1);
    await db.insert(schema.projectChatMessages).values(
      Array.from({ length: 50 }, (_, i) => ({
        id: `prueba-equipo-viejo-${i}`,
        projectId: PROYECTO,
        userText: `turno ${i}`,
        assistantReasoning: "hecho",
        status: "applied",
        createdAt: new Date(base + i * 1000),
      })),
    );
    await escribirMensajeDelEquipo({ projectId: PROYECTO, autorId: ELI, texto: "@dueno el nuevo", menciones: [DUENO] });
    const turnos = await getChatMessages(PROYECTO);
    expect(turnos).toHaveLength(50);
    expect(turnos.at(-1)).toMatchObject({ tipo: "persona", userText: "@dueno el nuevo" });
    expect(turnos[0]!.userText).toBe("turno 1");
  });
});
