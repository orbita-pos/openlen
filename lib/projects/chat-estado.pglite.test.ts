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

const { getChatMessages, leerTurnoDelUsuario, quitarEncargo } = await import("./chat");

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
      "userText" text not null, "attachedImage" jsonb, "assistantReasoning" text not null,
      "page" text, "actions" jsonb, "noDocChange" boolean, "toolResults" jsonb, "transcript" jsonb,
      "status" text not null, "createdAt" timestamp not null default now(),
      "conversation" text, "centicredits" integer, "durationMs" integer, "autorId" text, "origen" jsonb, "tipo" text, "menciones" jsonb);
    create table "projectMembers" ("id" text primary key, "projectId" text not null, "userId" text not null, "rol" text not null);
    insert into "projects" ("id", "userId") values ('p1', 'u1'), ('p2', 'u2');
  `);
  base.db = drizzle(pg, { schema });
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
