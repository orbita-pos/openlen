// @vitest-environment node
//
// LEN 2.1 · LA FILA DEL TURNO EN CURSO, CONTRA POSTGRES DE VERDAD.
//
// Las pruebas de la ruta doblan `lib/projects/chat`, así que no pueden ver lo
// que decide la base: que el cierre sólo toque una fila que SIGUE en curso,
// que un avance tardío no reabra un turno cerrado, que el historial del modelo
// no lea un turno a medias, que la fila de otro no exista. Es la lección de
// `escribir-data.pg.test.ts`: una prueba que no puede fallar por una causa no
// cubre esa causa.
//
// Sólo contra la base LOCAL (`exigirBaseLocal`, la misma guarda que Len-Bench).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import {
  abrirFilaDelTurno,
  avanceDelTurno,
  getChatMessages,
  leerTurnoDelUsuario,
  marcarCortadaSiSigueEnCurso,
  quitarFilaDelTurno,
  registrarTurnoDelServidor,
  turnosParaElHistorial,
} from "@/lib/projects/chat";

const USUARIO = "prueba-fila-en-curso-user";
const OTRO = "prueba-fila-en-curso-otro";
const PROYECTO = "prueba-fila-en-curso";

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
      title: "fila-en-curso",
      brief: "fila-en-curso",
      data: { html: "<!doctype html><html><body><h1>uno</h1></body></html>" },
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Las filas de la conversación caen con el proyecto (`onDelete: cascade`).
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(eq(schema.users.id, USUARIO));
  await db.delete(schema.users).where(eq(schema.users.id, OTRO));
});

/** La fila final que escribe la ruta, con lo mínimo. */
const final = (id: string, texto: string) => ({
  id,
  userText: "hazme la tienda",
  assistantReasoning: texto,
  status: "applied" as const,
  page: null,
  actions: [{ tool: "Write", status: "done" as const, summary: "/tienda/index.html" }],
  noDocChange: false,
  toolResults: [{ tool: "Write", ok: true, respuesta: { ok: true } }],
});

describe("la fila del turno en curso, contra Postgres", () => {
  it("se abre en curso y la lee su dueño, no otro", async () => {
    await abrirFilaDelTurno(PROYECTO, { id: "fila-a", userText: "hazme la tienda", page: null });
    const mia = await leerTurnoDelUsuario("fila-a", USUARIO);
    expect(mia?.enCurso).toBe(true);
    expect(mia?.status).toBe("applied");
    expect(mia?.assistantReasoning).toBe("");
    expect(await leerTurnoDelUsuario("fila-a", OTRO)).toBeNull();
  });

  it("el avance la llena, y la conversación la enseña, pero el historial del modelo NO", async () => {
    await avanceDelTurno(PROYECTO, "fila-a", {
      userText: "hazme la tienda\n↳ sin carrito",
      assistantReasoning: "Empiezo por el catálogo…",
      actions: [{ tool: "Read", status: "done", summary: "/index.html" }],
    });
    const leida = await leerTurnoDelUsuario("fila-a", USUARIO);
    expect(leida?.assistantReasoning).toBe("Empiezo por el catálogo…");
    expect(leida?.userText).toBe("hazme la tienda\n↳ sin carrito");
    expect(leida?.actions).toHaveLength(1);

    const conversacion = await getChatMessages(PROYECTO);
    expect(conversacion.find((t) => t.id === "fila-a")?.enCurso).toBe(true);
    const historial = await turnosParaElHistorial(PROYECTO, 10);
    expect(historial.some((f) => f.assistantReasoning === "Empiezo por el catálogo…")).toBe(false);
  });

  it("🔴 el cierre la deja entera y fuera de curso, y un avance tardío ya no la toca", async () => {
    await registrarTurnoDelServidor(PROYECTO, final("fila-a", "Listo: la tienda tiene catálogo."));
    const cerrada = await leerTurnoDelUsuario("fila-a", USUARIO);
    expect(cerrada?.enCurso).toBeUndefined();
    expect(cerrada?.assistantReasoning).toBe("Listo: la tienda tiene catálogo.");

    await avanceDelTurno(PROYECTO, "fila-a", { userText: "x", assistantReasoning: "tarde", actions: [] });
    expect((await leerTurnoDelUsuario("fila-a", USUARIO))?.assistantReasoning).toBe("Listo: la tienda tiene catálogo.");
    // Y ahora sí es historia.
    const historial = await turnosParaElHistorial(PROYECTO, 10);
    expect(historial.some((f) => f.assistantReasoning === "Listo: la tienda tiene catálogo.")).toBe(true);
  });

  it("quitar sólo quita una fila EN CURSO", async () => {
    await quitarFilaDelTurno(PROYECTO, "fila-a");
    expect(await leerTurnoDelUsuario("fila-a", USUARIO)).not.toBeNull();

    await abrirFilaDelTurno(PROYECTO, { id: "fila-vacia", userText: "hola", page: null });
    await quitarFilaDelTurno(PROYECTO, "fila-vacia");
    expect(await leerTurnoDelUsuario("fila-vacia", USUARIO)).toBeNull();
  });

  it("una huérfana pasa a cortada; una cerrada no se toca", async () => {
    await abrirFilaDelTurno(PROYECTO, { id: "fila-huerfana", userText: "hazme el menú", page: null });
    await marcarCortadaSiSigueEnCurso("fila-huerfana");
    const huerfana = await leerTurnoDelUsuario("fila-huerfana", USUARIO);
    expect(huerfana?.cortado).toBe(true);
    expect(huerfana?.enCurso).toBeUndefined();

    await marcarCortadaSiSigueEnCurso("fila-a");
    expect((await leerTurnoDelUsuario("fila-a", USUARIO))?.cortado).toBeUndefined();
  });

  it("sin fila abierta, el cierre la inserta como siempre (el camino de antes de 2.1)", async () => {
    await registrarTurnoDelServidor(PROYECTO, final("fila-sin-abrir", "Hecho."));
    const leida = await leerTurnoDelUsuario("fila-sin-abrir", USUARIO);
    expect(leida?.assistantReasoning).toBe("Hecho.");
    expect(leida?.enCurso).toBeUndefined();
  });
});
