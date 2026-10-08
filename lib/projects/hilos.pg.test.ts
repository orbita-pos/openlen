// @vitest-environment node
//
// LOS HILOS EN EL CÓDIGO, CONTRA POSTGRES (lib/projects/hilos.ts): menciones
// sólo a gente del proyecto, el «sin ver», contestar reabre y Len contesta.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import {
  apuntarPedidoALen,
  cambiarEstado,
  contextoParaLen,
  crearHilo,
  listarHilos,
  marcarVistas,
  mencionesSinVer,
  pedidosALenSinContestar,
  personasDelProyecto,
  responderHilo,
  respuestaDeLen,
} from "@/lib/projects/hilos";

const DUENO = "prueba-hilos-dueno";
const ANA = "prueba-hilos-ana";
const EXTRANO = "prueba-hilos-extrano";
const PROYECTO = "prueba-hilos";

beforeEach(async () => {
  for (const id of [DUENO, ANA, EXTRANO]) {
    await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido`, name: id.replace("prueba-hilos-", "") }).onConflictDoNothing();
  }
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.projectChatMessages).where(eq(schema.projectChatMessages.id, "prueba-hilos-fila-empezada"));
  await db.insert(schema.projects).values({ id: PROYECTO, userId: DUENO, title: "Con hilos", brief: "", data: { html: "<p>x</p>" } });
  await db.insert(schema.projectMembers).values({ projectId: PROYECTO, userId: ANA, rol: "editor" });
});

afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, PROYECTO));
  await db.delete(schema.users).where(inArray(schema.users.id, [DUENO, ANA, EXTRANO]));
});

describe("los hilos en el código", () => {
  it("las personas del proyecto: el dueño primero, luego los miembros", async () => {
    expect((await personasDelProyecto(PROYECTO)).map((p) => [p.userId, p.rol])).toEqual([
      [DUENO, "dueno"],
      [ANA, "editor"],
    ]);
  });

  it("🔴 sólo se menciona a gente del proyecto, sin repetir ni a uno mismo; y el mencionado lo tiene sin ver", async () => {
    const h = await crearHilo({
      projectId: PROYECTO,
      autorId: DUENO,
      ruta: "/src/App.jsx",
      linea: 12,
      codigo: "  return <main>",
      texto: "@ana ¿esto va así?",
      menciones: [ANA, ANA, EXTRANO, DUENO],
    });
    expect(h.mencionados).toEqual([ANA]);
    expect(await mencionesSinVer(PROYECTO, ANA)).toEqual({ total: 1, rutas: ["/src/App.jsx"] });
    expect(await mencionesSinVer(PROYECTO, EXTRANO)).toEqual({ total: 0, rutas: [] });

    const [delFichero] = await listarHilos(PROYECTO, ANA, "/src/App.jsx");
    expect(delFichero).toMatchObject({ linea: 12, codigo: "  return <main>", estado: "abierto", sinVer: 1 });
    expect(delFichero!.mensajes).toMatchObject([{ autorId: DUENO, autor: "dueno", texto: "@ana ¿esto va así?" }]);
    expect(await listarHilos(PROYECTO, ANA, "/otro.js")).toEqual([]);

    await marcarVistas(PROYECTO, ANA, [h.hiloId]);
    expect((await mencionesSinVer(PROYECTO, ANA)).total).toBe(0);
  });

  it("contestar reabre un hilo resuelto, y Len contesta como Len (sin autor) con su turno", async () => {
    const h = await crearHilo({ projectId: PROYECTO, autorId: ANA, ruta: "/index.html", linea: 3, codigo: "<h1>", texto: "@Len pon el título en azul", menciones: [] });
    expect(await respuestaDeLen({ projectId: PROYECTO, hiloId: h.hiloId, texto: "Listo: el título va en azul.", filaId: "fila-1" })).toBe(true);
    expect(await cambiarEstado(PROYECTO, h.hiloId, "resuelto")).toBe(true);
    await responderHilo({ projectId: PROYECTO, hiloId: h.hiloId, autorId: DUENO, texto: "Mejor más oscuro", menciones: [] });
    const [hilo] = await listarHilos(PROYECTO, DUENO, "/index.html");
    expect(hilo!.estado).toBe("abierto");
    expect(hilo!.mensajes.map((m) => [m.autor, m.texto, m.filaId])).toEqual([
      ["ana", "@Len pon el título en azul", null],
      [null, "Listo: el título va en azul.", "fila-1"],
      ["dueno", "Mejor más oscuro", null],
    ]);
    // Un hilo de otro proyecto no se contesta ni se resuelve desde éste.
    expect(await respuestaDeLen({ projectId: "otro", hiloId: h.hiloId, texto: "x", filaId: null })).toBe(false);
    expect(await responderHilo({ projectId: "otro", hiloId: h.hiloId, autorId: DUENO, texto: "x", menciones: [] })).toBeNull();
    expect(await cambiarEstado("otro", h.hiloId, "resuelto")).toBe(false);
  });

  it("🔴 un pedido a Len apuntado queda «sin contestar» hasta que Len contesta con su fila, y dice si llegó a empezar", async () => {
    const pedido = { idioma: "es", url: "http://localhost/api/projects/x/hilos" };
    const a = await crearHilo({ projectId: PROYECTO, autorId: ANA, ruta: "/index.html", linea: 3, codigo: "<h1>", texto: "Ojo con esto", menciones: [] });
    const pide = await responderHilo({ projectId: PROYECTO, hiloId: a.hiloId, autorId: ANA, texto: "@Len pon el título en azul", menciones: [] });
    await apuntarPedidoALen({ mensajeId: pide!.mensajeId, filaId: "prueba-hilos-fila-nueva", pedido });
    const b = await crearHilo({ projectId: PROYECTO, autorId: DUENO, ruta: "/index.html", linea: 9, codigo: "<p>", texto: "@Len quita esto", menciones: [] });
    await apuntarPedidoALen({ mensajeId: b.mensajeId, filaId: "prueba-hilos-fila-empezada", pedido });
    // El de B llegó a abrir su fila del chat: el turno empezó.
    await db.insert(schema.projectChatMessages).values({ id: "prueba-hilos-fila-empezada", projectId: PROYECTO, userText: "@Len quita esto", assistantReasoning: "", status: "en_curso" });

    const despues = new Date(Date.now() + 60_000);
    const mios = (await pedidosALenSinContestar(despues)).filter((p) => p.projectId === PROYECTO);
    expect(mios.map((p) => [p.hiloId, p.autorId, p.texto, p.filaId, p.empezado, p.pedido])).toEqual([
      [a.hiloId, ANA, "@Len pon el título en azul", "prueba-hilos-fila-nueva", false, pedido],
      [b.hiloId, DUENO, "@Len quita esto", "prueba-hilos-fila-empezada", true, pedido],
    ]);
    // Lo escrito después del arranque no es de un reinicio.
    expect((await pedidosALenSinContestar(new Date(Date.now() - 60_000))).filter((p) => p.projectId === PROYECTO)).toEqual([]);

    // El contexto para Len: lo dicho ANTES del pedido, no el pedido.
    const [hiloA] = (await listarHilos(PROYECTO, ANA, "/index.html")).filter((h) => h.id === a.hiloId);
    expect(contextoParaLen(hiloA!, pide!.mensajeId)).toBe(
      "[Requested from a comment thread in the code: `/index.html:3` — `<h1>`. Your final reply is also posted in that thread.]\nEarlier in the thread:\n- ana: Ojo con esto",
    );

    // Len contesta con la fila de A: A deja de estar pendiente.
    await respuestaDeLen({ projectId: PROYECTO, hiloId: a.hiloId, texto: "Hecho.", filaId: "prueba-hilos-fila-nueva" });
    expect((await pedidosALenSinContestar(despues)).filter((p) => p.projectId === PROYECTO).map((p) => p.hiloId)).toEqual([b.hiloId]);
  });
});
