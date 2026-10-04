// @vitest-environment node
//
// LAS CHARLAS Y EL 👍/👎 DEL CHAT NUEVO (plans/new-chat/), CONTRA POSTGRES.
//
// «Empezar de cero» archiva en vez de borrar, y volver a una charla la pone en
// curso en UNA sentencia. Lo que hay que impedir no se ve con la base doblada:
// que el panel o el historial del modelo lean una charla archivada, que el
// recorte de 50 se coma las archivadas, que se cambie de charla con un turno
// trabajando. Sólo contra la base LOCAL (`exigirBaseLocal`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import {
  abrirFilaDelTurno,
  appendChatMessage,
  getChatMessages,
  isProjectOwner,
  listArchivedConversations,
  registrarTurnoDelServidor,
  reopenConversation,
  startNewConversation,
  turnosParaElHistorial,
} from "@/lib/projects/chat";
import { listTurnFeedback, removeTurnFeedback, saveTurnFeedback } from "@/lib/chat/feedback";

const USUARIO = "prueba-charlas-user";
const OTRO = "prueba-charlas-otro";
const PROYECTO = "prueba-charlas";

beforeAll(async () => {
  await exigirBaseLocal();
  await db
    .insert(schema.users)
    .values([
      { id: USUARIO, email: `${USUARIO}@ejemplo.invalido` },
      { id: OTRO, email: `${OTRO}@ejemplo.invalido` },
    ])
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({
      id: PROYECTO,
      userId: USUARIO,
      title: "charlas",
      brief: "charlas",
      data: { html: "<!doctype html><html><body><h1>uno</h1></body></html>" },
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Las filas y los votos caen con el proyecto (`onDelete: cascade`).
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
  await db.delete(schema.users).where(eq(schema.users.id, OTRO));
});

const turno = (id: string, texto: string) => ({
  id,
  userText: texto,
  assistantReasoning: `hecho: ${texto}`,
  status: "applied" as const,
  page: null,
});

describe("las charlas del proyecto, contra Postgres", () => {
  it("el proyecto es de su dueño y de nadie más", async () => {
    expect(await isProjectOwner(PROYECTO, USUARIO)).toBe(true);
    expect(await isProjectOwner(PROYECTO, OTRO)).toBe(false);
  });

  it("«Empezar de cero» archiva: el panel y el historial del modelo dejan de verla", async () => {
    await appendChatMessage(PROYECTO, turno("c1-a", "pon fotos"));
    await appendChatMessage(PROYECTO, turno("c1-b", "y un formulario"));
    expect((await getChatMessages(PROYECTO)).map((t) => t.id)).toEqual(["c1-a", "c1-b"]);

    const r = await startNewConversation(PROYECTO);
    expect(r.ok).toBe(true);
    expect(r.ok && r.archived).toBeTruthy();
    expect(await getChatMessages(PROYECTO)).toEqual([]);
    expect(await turnosParaElHistorial(PROYECTO, 20)).toEqual([]);

    const archivadas = await listArchivedConversations(PROYECTO);
    expect(archivadas).toHaveLength(1);
    expect(archivadas[0]?.title).toBe("pon fotos");
    expect(archivadas[0]?.turns).toBe(2);
  });

  it("sin nada en curso no archiva una charla vacía", async () => {
    const r = await startNewConversation(PROYECTO);
    expect(r).toEqual({ ok: true, archived: null });
    expect(await listArchivedConversations(PROYECTO)).toHaveLength(1);
  });

  it("volver a una archivada la pone en curso y archiva la que había, sin perder ninguna", async () => {
    await appendChatMessage(PROYECTO, turno("c2-a", "cambia el color"));
    const [vieja] = await listArchivedConversations(PROYECTO);
    const r = await reopenConversation(PROYECTO, vieja!.id);
    expect(r.ok).toBe(true);
    expect((await getChatMessages(PROYECTO)).map((t) => t.id)).toEqual(["c1-a", "c1-b"]);
    const archivadas = await listArchivedConversations(PROYECTO);
    expect(archivadas.map((c) => c.title)).toEqual(["cambia el color"]);
  });

  it("una charla que no existe es 404, no un vacío", async () => {
    expect(await reopenConversation(PROYECTO, "no-existe")).toEqual({ ok: false, reason: "not_found" });
  });

  it("con un turno trabajando no se cambia de charla", async () => {
    await abrirFilaDelTurno(PROYECTO, { id: "c3-en-curso", userText: "hazme la tienda", page: null });
    expect(await startNewConversation(PROYECTO)).toEqual({ ok: false, reason: "busy" });
    const [archivada] = await listArchivedConversations(PROYECTO);
    expect(await reopenConversation(PROYECTO, archivada!.id)).toEqual({ ok: false, reason: "busy" });
    await registrarTurnoDelServidor(PROYECTO, {
      ...turno("c3-en-curso", "hazme la tienda"),
      toolResults: null,
      centicredits: 118,
      durationMs: 26_400,
    });
    expect((await startNewConversation(PROYECTO)).ok).toBe(true);
  });

  it("lo que cobró y tardó el turno vuelve al recargar", async () => {
    const [archivada] = await listArchivedConversations(PROYECTO);
    await reopenConversation(PROYECTO, archivada!.id);
    const t = (await getChatMessages(PROYECTO)).find((x) => x.id === "c3-en-curso");
    expect(t?.centicredits).toBe(118);
    expect(t?.durationMs).toBe(26_400);
  });
});

describe("el 👍/👎 de un turno, contra Postgres", () => {
  it("se guarda, se cambia y se quita; los motivos de un 👍 no cuentan", async () => {
    await saveTurnFeedback(PROYECTO, USUARIO, "c1-a", { rating: "down", reasons: ["made_up", "too_slow"], note: " tardó " });
    expect((await listTurnFeedback(PROYECTO, USUARIO))["c1-a"]).toEqual({
      rating: "down",
      reasons: ["made_up", "too_slow"],
      note: "tardó",
    });
    await saveTurnFeedback(PROYECTO, USUARIO, "c1-a", { rating: "up", reasons: ["made_up"], note: null });
    expect((await listTurnFeedback(PROYECTO, USUARIO))["c1-a"]).toEqual({ rating: "up", reasons: [], note: null });
    expect(await listTurnFeedback(PROYECTO, OTRO)).toEqual({});
    await removeTurnFeedback(PROYECTO, USUARIO, "c1-a");
    expect(await listTurnFeedback(PROYECTO, USUARIO)).toEqual({});
  });
});
