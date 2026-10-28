// @vitest-environment node
//
// EL ESTADO DE LA CHARLA CONTRA POSTGRES DE VERDAD (lote 7-8 de Len 2.5). El SQL
// de jsonb de las piezas 7 y 8 —`transcript->>'planMode'`, `->'goal'`,
// `jsonb_typeof`, `jsonb_set`— sólo tenía dobles. PGlite es Postgres en memoria
// con el esquema de Drizzle: la semántica es la de producción. De `projects`,
// sólo las columnas que se tocan; `projectChatMessages`, entera.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import type { GoalSnapshot } from "@/lib/agent/goal";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { abrirFilaDelTurno, guardarMarcaDelTurno, marcarCortadaSiSigueEnCurso, CHAT_RETENTION_DAYS, filasParaElHistorialConEquipo, getChatMessages, listArchivedConversations, pruneOldConversations, latestTodoListForChat, leerTurnoDelUsuario, quitarEncargo, registrarTurnoDelServidor, reopenConversation, turnosParaElHistorial } =
  await import("./chat");

const ENCARGO: GoalSnapshot = {
  id: "g1",
  revision: 3,
  objective: "Montar la tienda",
  phase: "active",
  maxGoalRounds: 256,
  roundsStarted: 2,
};
let pg: PGlite;

/** Una fila de la charla en curso; sin `transcript`, la columna queda NULL. */
async function fila(o: { id: string; minuto: number; status?: string; transcript?: unknown }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "transcript")
     values ($1, 'p1', 'hola', '', $2, $3, $4::jsonb)`,
    [o.id, o.status ?? "applied", new Date(Date.UTC(2026, 9, 5, 12, o.minuto)), o.transcript === undefined ? null : JSON.stringify(o.transcript)],
  );
}

/** Una fila con tarjetas (la lista de progreso vive en las de `todo_write`). */
async function filaConTarjetas(o: { id: string; minuto: number; status?: string; actions: unknown; conversation?: string }) {
  await pg.query(
    `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "actions", "conversation")
     values ($1, 'p1', 'hola', '', $2, $3, $4::jsonb, $5)`,
    [o.id, o.status ?? "applied", new Date(Date.UTC(2026, 9, 5, 12, o.minuto)), JSON.stringify(o.actions), o.conversation ?? null],
  );
}

/** El encargo de una fila tal como lo guarda Postgres, y su tipo jsonb. */
async function goalCrudo(id: string) {
  const r = await pg.query<{ g: unknown; tipo: string | null }>(
    `select "transcript"->'goal' as g, jsonb_typeof("transcript"->'goal') as tipo from "projectChatMessages" where id = $1`,
    [id],
  );
  return r.rows[0];
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    create table "projects" ("id" text primary key, "userId" text not null);
    create table "projectChatMessages" (
      "id" text primary key,
      "projectId" text not null references "projects"("id") on delete cascade,
      "userText" text not null, "attachedImage" jsonb, "attachedFiles" jsonb, "assistantReasoning" text not null,
      "page" text, "actions" jsonb, "noDocChange" boolean, "toolResults" jsonb, "transcript" jsonb,
      "status" text not null, "createdAt" timestamp not null default now(),
      "conversation" text, "centicredits" integer, "durationMs" integer, "autorId" text, "origen" jsonb, "tipo" text, "menciones" jsonb, "endReason" text,
      "compaction" jsonb);
    create table "projectMembers" ("id" text primary key, "projectId" text not null, "userId" text not null, "rol" text not null);
    insert into "projects" ("id", "userId") values ('p1', 'u1'), ('p2', 'u2');
  `);
  base.db = drizzle(pg, { schema });
});

// A11 (spec local 2026-10-25-a11-continuity): el resumen se guarda como marca en
// la fila del turno, como el `compact_boundary` de Claude Code en su transcripción.
describe("A11 · la marca de compactación en la fila", () => {
  const MARCA = {
    messages: [{ role: "user", content: "<compacted-summary>\nx\n</compacted-summary>" }],
    fromTranscript: 3,
    trigger: "pressure",
    preTokens: 900000,
    postTokens: 120000,
  };
  it("🔴 la fila guarda la marca de compactación y la devuelve tal cual (jsonb)", async () => {
    await registrarTurnoDelServidor("p1", {
      id: "t1",
      userText: "sigue",
      assistantReasoning: "Hecho.",
      status: "applied",
      compaction: MARCA,
    } as Parameters<typeof registrarTurnoDelServidor>[1]);
    const r = await pg.query<{ compaction: unknown }>(`select "compaction" from "projectChatMessages" where id = 't1'`);
    expect(r.rows[0]?.compaction).toEqual(MARCA);
  });
  it("sin marca, la columna queda NULL", async () => {
    await registrarTurnoDelServidor("p1", { id: "t2", userText: "hola", assistantReasoning: "Hola.", status: "applied" });
    const r = await pg.query<{ compaction: unknown }>(`select "compaction" from "projectChatMessages" where id = 't2'`);
    expect(r.rows[0]?.compaction).toBeNull();
  });
});

describe("A11 · el historial es la charla entera, desde la última marca", () => {
  // Como Claude Code, que anota el `compact_boundary` en cuanto resume: la marca
  // entra en la fila del turno que sigue en curso, y si el servidor se reinicia
  // a mitad (la fila acaba cortada) el turno siguiente arranca en ella.
  it("🔴 la marca guardada a mitad de turno sobrevive a un turno cortado; una fila ya cerrada no se toca", async () => {
    const marca = { messages: [{ role: "user" as const, content: "resumen" }], fromTranscript: 0, trigger: "pressure" as const, preTokens: 900, postTokens: 90 };
    await abrirFilaDelTurno("p1", { id: "viva", userText: "sigue", page: null });
    await guardarMarcaDelTurno("p1", "viva", marca);
    await marcarCortadaSiSigueEnCurso("viva");
    const historial = await turnosParaElHistorial("p1");
    expect(historial.at(-1)?.compaction).toEqual(marca);
    await guardarMarcaDelTurno("p1", "viva", { ...marca, preTokens: 1 });
    expect((await turnosParaElHistorial("p1")).at(-1)?.compaction?.preTokens).toBe(900);
  });

  const marca = (texto: string) => ({ messages: [{ role: "user", content: `<compacted-summary>
${texto}
</compacted-summary>` }], fromTranscript: 0, trigger: "pressure", preTokens: 9, postTokens: 1 });
  /** Una fila cerrada; `tipo: "persona"` es un mensaje del equipo. */
  async function turno(o: { id: string; minuto: number; texto?: string; compaction?: unknown; tipo?: string; conversation?: string }) {
    await pg.query(
      `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "transcript", "compaction", "tipo", "conversation")
       values ($1, 'p1', $2, '', 'applied', $3, '{"mensajes":[],"leidos":[]}'::jsonb, $4::jsonb, $5, $6)`,
      [o.id, o.texto ?? `turno ${o.id}`, new Date(Date.UTC(2026, 9, 5, 12, o.minuto)), o.compaction === undefined ? null : JSON.stringify(o.compaction), o.tipo ?? null, o.conversation ?? null],
    );
  }

  it("🔴 C01: sin marca, los 36 turnos, el primero incluido", async () => {
    await turno({ id: "t0", minuto: 0, texto: "NO_CAMBIAR_PRECIOS" });
    for (let i = 1; i < 36; i++) await turno({ id: `t${i}`, minuto: i });
    const filas = await turnosParaElHistorial("p1");
    expect(filas).toHaveLength(36);
    expect(filas[0]!.userText).toBe("NO_CAMBIAR_PRECIOS");
  });

  it("🔴 con una marca en el turno 20, del 20 al último, con la marca", async () => {
    for (let i = 0; i < 36; i++) await turno({ id: `t${i}`, minuto: i, compaction: i === 20 ? marca("lo de antes") : undefined });
    const filas = await turnosParaElHistorial("p1");
    expect(filas).toHaveLength(16);
    expect(filas[0]!.compaction).toEqual(marca("lo de antes"));
  });

  it("🔴 con miembros: el mensaje del equipo de después de la marca entra en su orden; el de antes, no", async () => {
    await turno({ id: "a", minuto: 0 });
    await turno({ id: "antes", minuto: 1, tipo: "persona", texto: "viejo" });
    await turno({ id: "m", minuto: 2, compaction: marca("resumen") });
    await turno({ id: "despues", minuto: 3, tipo: "persona", texto: "nuevo" });
    await turno({ id: "b", minuto: 4 });
    const filas = await filasParaElHistorialConEquipo("p1");
    expect(filas.map((f) => f.fila.userText)).toEqual(["turno m", "nuevo", "turno b"]);
  });

  // Lo que el historial necesita para decirle a Len que un turno se cortó
  // (`CUT_OFF_TURN_MARK`). Sólo en la cortada: las demás filas, como antes.
  it("🔴 la fila cortada llega marcada al historial, también con miembros; las demás, sin la propiedad", async () => {
    await turno({ id: "bien", minuto: 0 });
    // Como la deja el reenganche cuando nadie la corre (GET /api/agent/turno/[fila]).
    await abrirFilaDelTurno("p1", { id: "muerta", userText: "hazme la carta", page: null });
    await marcarCortadaSiSigueEnCurso("muerta");
    const filas = await turnosParaElHistorial("p1");
    expect(filas.map((f) => f.userText)).toEqual(["turno bien", "hazme la carta"]);
    expect(filas[0]).not.toHaveProperty("cutOff");
    expect(filas[1]!.cutOff).toBe(true);
    const conEquipo = await filasParaElHistorialConEquipo("p1");
    expect(conEquipo.map((f) => f.fila.cutOff ?? false)).toEqual(filas.map((f) => f.cutOff ?? false));
  });

  it("🔴 al reabrir una charla archivada, su historial arranca en SU marca", async () => {
    await turno({ id: "x1", minuto: 0, conversation: "c1" });
    await turno({ id: "x2", minuto: 1, conversation: "c1", compaction: marca("de c1") });
    await turno({ id: "x3", minuto: 2, conversation: "c1" });
    await turno({ id: "y1", minuto: 3, compaction: marca("de la en curso") });
    expect(await reopenConversation("p1", "c1")).toMatchObject({ ok: true });
    const filas = await turnosParaElHistorial("p1");
    expect(filas.map((f) => f.userText)).toEqual(["turno x2", "turno x3"]);
  });
});

// A11: como Claude Code (`cleanupPeriodDays`, 30 por defecto): una charla se
// guarda entera 30 días desde su último mensaje; sin tope de filas ni de charlas.
// Los PDF del mensaje (26/10): la fila los guarda, el historial de Len los lee
// (su nota y Read) y el panel los trae para la burbuja.
describe("los PDF del mensaje en la fila", () => {
  it("🔴 se guardan al abrir el turno y vuelven en el historial y en el panel; sin ellos, NULL", async () => {
    const menu = { url: "https://cdn.example/uploads/p1/abc123.pdf", name: "menu.pdf", size: 2048 };
    await abrirFilaDelTurno("p1", { id: "con-pdf", userText: "pon mi menú", page: null, attachedFiles: [menu] });
    await abrirFilaDelTurno("p1", { id: "sin-pdf", userText: "hola", page: null });
    // El historial es de turnos cerrados: se cierran como lo haría un corte.
    await marcarCortadaSiSigueEnCurso("con-pdf");
    await marcarCortadaSiSigueEnCurso("sin-pdf");
    const historial = await turnosParaElHistorial("p1");
    expect(historial.map((f) => f.attachedFiles ?? null)).toEqual([[menu], null]);
    const panel = await getChatMessages("p1");
    expect(panel.find((t) => t.id === "con-pdf")?.attachedFiles).toEqual([menu]);
    expect(panel.find((t) => t.id === "sin-pdf")?.attachedFiles).toBeUndefined();
  });
});

describe("A11 · retención de 30 días", () => {
  const AHORA = new Date(Date.UTC(2026, 9, 25, 12, 0));
  const haceDias = (d: number, minuto = 0) => new Date(AHORA.getTime() - d * 86_400_000 + minuto * 60_000);
  async function filaEn(o: { id: string; at: Date; conversation?: string }) {
    await pg.query(
      `insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt", "conversation") values ($1, 'p1', 'x', '', 'applied', $2, $3)`,
      [o.id, o.at, o.conversation ?? null],
    );
  }
  const cuantas = async (where = "true") => Number((await pg.query<{ n: number }>(`select count(*)::int as n from "projectChatMessages" where ${where}`)).rows[0]!.n);

  it("🔴 son 30 días, como Claude Code", () => {
    expect(CHAT_RETENTION_DAYS).toBe(30);
  });

  it("🔴 una charla de 60 filas recientes no pierde ninguna, tampoco al escribir un turno más", async () => {
    for (let i = 0; i < 60; i++) await filaEn({ id: `r${i}`, at: haceDias(1, i) });
    await registrarTurnoDelServidor("p1", { id: "nuevo", userText: "hola", assistantReasoning: "Hola.", status: "applied" });
    expect(await cuantas()).toBe(61);
  });

  it("🔴 se borra entera la charla cuyo último mensaje tiene más de 30 días; la de 29 y 12 archivadas recientes, no", async () => {
    await filaEn({ id: "v1", at: haceDias(40), conversation: "vieja" });
    await filaEn({ id: "v2", at: haceDias(31), conversation: "vieja" });
    await filaEn({ id: "n1", at: haceDias(45), conversation: "casi" });
    await filaEn({ id: "n2", at: haceDias(29), conversation: "casi" });
    for (let i = 0; i < 12; i++) await filaEn({ id: `a${i}`, at: haceDias(2, i), conversation: `k${i}` });
    await pruneOldConversations("p1", AHORA);
    expect(await cuantas(`"conversation" = 'vieja'`)).toBe(0);
    expect(await cuantas(`"conversation" = 'casi'`)).toBe(2);
    expect(await cuantas(`"conversation" like 'k%'`)).toBe(12);
  });

  it("la charla en curso con su último mensaje de hace 31 días también se va; la de otro proyecto no se toca", async () => {
    await filaEn({ id: "e1", at: haceDias(31) });
    await pg.query(`insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt") values ('otro', 'p2', 'x', '', 'applied', $1)`, [haceDias(90)]);
    await pruneOldConversations("p1", AHORA);
    expect(await cuantas(`"projectId" = 'p1'`)).toBe(0);
    expect(await cuantas(`"projectId" = 'p2'`)).toBe(1);
  });

  // Como Claude Code, que borra al arrancar lo que pasó los 30 días: una charla
  // caducada no se lista, y volver a ella no archiva la de ahora para nada.
  it("🔴 una archivada de hace 31 días no se lista ni se reabre; la charla en curso se queda donde estaba", async () => {
    const ya = Date.now();
    const antes = (d: number) => new Date(ya - d * 86_400_000);
    await filaEn({ id: "cad1", at: antes(31), conversation: "caducada" });
    await filaEn({ id: "rec1", at: antes(2), conversation: "reciente" });
    await filaEn({ id: "hoy1", at: antes(0) });
    expect((await listArchivedConversations("p1")).map((c) => c.id)).toEqual(["reciente"]);
    expect(await reopenConversation("p1", "caducada")).toEqual({ ok: false, reason: "not_found" });
    expect(await cuantas(`"id" = 'hoy1' and "conversation" is null`)).toBe(1);
  });

  it("🔴 el chat carga las 50 más RECIENTES, de la más vieja a la más reciente", async () => {
    for (let i = 0; i < 60; i++) await filaEn({ id: `m${String(i).padStart(2, "0")}`, at: haceDias(1, i) });
    const turnos = await getChatMessages("p1");
    expect(turnos).toHaveLength(50);
    expect(turnos[0]!.id).toBe("m10");
    expect(turnos.at(-1)!.id).toBe("m59");
  });

  it("🔴 C15: 120 filas por páginas de 50, de atrás hacia delante, hasta la primera", async () => {
    const id = (i: number) => `q${String(i).padStart(3, "0")}`;
    for (let i = 1; i <= 120; i++) await filaEn({ id: id(i), at: haceDias(1, i) });
    const primera = await getChatMessages("p1");
    expect(primera.map((t) => t.id)).toEqual(Array.from({ length: 50 }, (_, k) => id(71 + k)));
    const segunda = await getChatMessages("p1", { before: primera[0]!.id });
    expect(segunda.map((t) => t.id)).toEqual(Array.from({ length: 50 }, (_, k) => id(21 + k)));
    const tercera = await getChatMessages("p1", { before: segunda[0]!.id });
    expect(tercera.map((t) => t.id)).toEqual(Array.from({ length: 20 }, (_, k) => id(1 + k)));
    expect(await getChatMessages("p1", { before: tercera[0]!.id })).toEqual([]);
  });

  // El cursor es la FILA (fecha y, a igual fecha, id), como el `uuid` de cada
  // mensaje de Claude Code: un milisegundo del navegador no distingue filas que
  // la base guarda con microsegundos, ni dos con la misma hora exacta.
  it("🔴 en el borde de una página, las filas de la misma hora (y del mismo milisegundo) no se pierden", async () => {
    const en = async (id: string, at: string) =>
      pg.query(`insert into "projectChatMessages" ("id", "projectId", "userText", "assistantReasoning", "status", "createdAt") values ($1, 'p1', 'x', '', 'applied', $2::timestamp)`, [id, at]);
    await en("e1", "2026-10-24 12:00:00.100100");
    await en("e2", "2026-10-24 12:00:00.100200");
    await en("e3", "2026-10-24 12:00:00.100300");
    await en("e4", "2026-10-24 12:00:01");
    await en("e5", "2026-10-24 12:00:01");
    const vistas: string[] = [];
    let pagina = await getChatMessages("p1", { limit: 2 });
    while (pagina.length > 0) {
      vistas.unshift(...pagina.map((t) => t.id));
      pagina = await getChatMessages("p1", { before: pagina[0]!.id, limit: 2 });
    }
    expect(vistas).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("un cursor que no es una fila de esta charla no trae nada", async () => {
    await filaEn({ id: "z1", at: haceDias(1) });
    expect(await getChatMessages("p1", { before: "no-existe" })).toEqual([]);
  });

  it("🔴 la fila con la marca dice cuántos tokens se resumieron; las demás, nada", async () => {
    await filaEn({ id: "s1", at: haceDias(1, 1) });
    await filaEn({ id: "s2", at: haceDias(1, 2) });
    await pg.query(`update "projectChatMessages" set "compaction" = $1 where "id" = 's2'`, [
      JSON.stringify({ messages: [{ role: "user", content: "resumen" }], fromTranscript: 0, trigger: "pressure", preTokens: 912000, postTokens: 9000 }),
    ]);
    const turnos = await getChatMessages("p1");
    expect(turnos.find((t) => t.id === "s2")?.compactedTokens).toBe(912000);
    expect(turnos.find((t) => t.id === "s1")).not.toHaveProperty("compactedTokens");
  });
});

describe("el estado de la charla en Postgres", () => {
  it("🔴 manda la última fila CERRADA con transcripción: ni la en curso ni la de transcript NULL", async () => {
    await fila({ id: "a", minuto: 1, transcript: { mensajes: [], leidos: [], planMode: true, goal: ENCARGO } });
    await fila({ id: "b", minuto: 2 }); // cayó sin transcripción
    await fila({ id: "c", minuto: 3, status: "en_curso", transcript: { mensajes: [], leidos: [] } });
    const turnos = await getChatMessages("p1");
    const cerrado = turnos.find((t) => t.id === "b")!;
    expect(cerrado.planMode).toBe(true);
    expect(cerrado.goal).toMatchObject({ id: "g1", objective: "Montar la tienda", roundsStarted: 2, activation: "disarmed" });
    const enCurso = turnos.find((t) => t.id === "c")!;
    expect(enCurso.enCurso).toBe(true);
    expect(enCurso.planMode).toBeUndefined();
  });

  it("un turno cerrado posterior sin modo plan ni encargo los apaga", async () => {
    await fila({ id: "a", minuto: 1, transcript: { mensajes: [], leidos: [], planMode: true, goal: ENCARGO } });
    await fila({ id: "b", minuto: 2, transcript: { mensajes: [{ role: "assistant", content: "hecho" }], leidos: [] } });
    const ultimo = (await getChatMessages("p1")).at(-1)!;
    expect(ultimo.planMode).toBeUndefined();
    expect(ultimo.goal).toBeUndefined();
  });

  it("el turno del reenganche trae SU encargo, y el de otro usuario no existe", async () => {
    await fila({ id: "a", minuto: 1, transcript: { mensajes: [], leidos: [], goal: ENCARGO } });
    expect((await leerTurnoDelUsuario("a", "u1"))?.goal).toMatchObject({ id: "g1", revision: 3 });
    expect(await leerTurnoDelUsuario("a", "u2")).toBeNull();
  });

  it("🔴 quitarEncargo del dueño deja goal: null en la última fila con transcripción y el pliegue ya no lo ve", async () => {
    await fila({ id: "a", minuto: 1, transcript: { mensajes: [], leidos: [], planMode: true, goal: ENCARGO } });
    await fila({ id: "b", minuto: 2 });
    expect(await quitarEncargo("p1", "u1")).toBe("ok");
    expect(await goalCrudo("a")).toEqual({ g: null, tipo: "null" });
    const cerrado = (await getChatMessages("p1")).find((t) => t.id === "b")!;
    expect(cerrado.goal).toBeUndefined();
    // Lo demás de la foto, intacto.
    expect(cerrado.planMode).toBe(true);
  });

  it("🔴 quitarEncargo de otro usuario: no_encontrado y no toca nada", async () => {
    await fila({ id: "a", minuto: 1, transcript: { mensajes: [], leidos: [], goal: ENCARGO } });
    expect(await quitarEncargo("p1", "u2")).toBe("no_encontrado");
    expect((await goalCrudo("a"))!.tipo).toBe("object");
  });
});

describe("latestTodoListForChat (la lista de progreso, spec local 2026-10-15)", () => {
  const lista = (estado: string) => [{ tool: "todo_write", status: "done", summary: "", todos: [{ content: "Galería", status: estado }] }];

  it("devuelve la lista de la última fila que la tiene, aunque luego haya turnos sin lista", async () => {
    await filaConTarjetas({ id: "a", minuto: 1, actions: lista("pending") });
    await filaConTarjetas({ id: "b", minuto: 2, actions: [{ tool: "Write", status: "done", summary: "" }] });
    expect(await latestTodoListForChat("p1")).toEqual([{ content: "Galería", status: "pending" }]);
  });

  it("🔴 no la saca de un turno DESHECHO, ni del que sigue en curso, ni de otra charla", async () => {
    await filaConTarjetas({ id: "a", minuto: 1, actions: lista("completed") });
    await filaConTarjetas({ id: "b", minuto: 2, status: "reverted", actions: lista("pending") });
    await filaConTarjetas({ id: "c", minuto: 3, status: "en_curso", actions: lista("in_progress") });
    await filaConTarjetas({ id: "d", minuto: 4, conversation: "archivada", actions: lista("pending") });
    expect(await latestTodoListForChat("p1")).toEqual([{ content: "Galería", status: "completed" }]);
  });

  it("sin ninguna lista, null", async () => {
    await filaConTarjetas({ id: "a", minuto: 1, actions: [{ tool: "Write", status: "done", summary: "" }] });
    expect(await latestTodoListForChat("p1")).toBeNull();
  });
});
