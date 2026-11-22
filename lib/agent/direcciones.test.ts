import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _vaciarTodo,
  abrirTurno,
  cancelar,
  cerrarTurno,
  dirigir,
  dismissQuestion,
  esperarRespuesta,
  leerDireccion,
  preguntaPendiente,
  responder,
  turnoDeLaFila,
  filaEnMarcha,
  turnoVivoDelProyecto,
  liveTurns,
  rondaSiguiente,
  siguienteDeLaFila,
  MAX_DIRECCION,
  noteWidgetDrawn,
  openTurnOf,
  setVisualStates,
  visualStatesOf,
  widgetsDrawnBy,
} from "./direcciones";
import { QUESTION_DISMISSED, type QuestionAnswer } from "./ask-user-question";

beforeEach(() => _vaciarTodo());

// The phone's «Tareas · Trabajando» (spec local 2026-10-31-len-movil, §5.4).
describe("liveTurns", () => {
  it("lists the turns running in a project, and forgets a closed one", () => {
    const now = Date.now();
    abrirTurno("t1", "u1", now, { projectId: "p1", filaId: "row-1" });
    abrirTurno("t2", "u2", now);
    expect(liveTurns(now)).toEqual([{ projectId: "p1", userId: "u1", rowId: "row-1", startedAt: now }]);
    cerrarTurno("t1");
    expect(liveTurns()).toEqual([]);
  });
});

describe("corregirle el rumbo al Agente a media faena", () => {
  it("lo que se deja, se lee", () => {
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "u1", "no toques el hero")).toBe("ok");
    expect(leerDireccion("t1")).toBe("no toques el hero");
  });

  it("SE CONSUME: no se relee en la vuelta siguiente", () => {
    // Si se quedara, el modelo leeria la misma correccion en cada vuelta como
    // si fuera nueva, y actuaria cinco veces sobre ella.
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "para de buscar fotos");
    expect(leerDireccion("t1")).toBe("para de buscar fotos");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("dos correcciones antes de la siguiente vuelta se leen las DOS, en orden", () => {
    // Perder la primera seria peor que juntarlas: el usuario escribio las dos.
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "primera");
    dirigir("t1", "u1", "segunda");
    expect(leerDireccion("t1")).toBe("primera\nsegunda");
  });

  it("🔴 un turno AJENO no se puede dirigir", () => {
    // El id del turno viaja al cliente por el SSE. Sin esta comprobacion,
    // quien adivine uno escribe en la pagina de otro.
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "otro", "borra todo")).toBe("ajeno");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("un turno que no existe no acepta nada", () => {
    expect(dirigir("fantasma", "u1", "hola")).toBe("no_existe");
  });

  it("un texto vacio no cuenta como correccion", () => {
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "u1", "   \n  ")).toBe("vacio");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("se recorta: una correccion es una frase, no un documento", () => {
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "x".repeat(MAX_DIRECCION + 500));
    expect(leerDireccion("t1")!.length).toBe(MAX_DIRECCION);
  });

  it("al cerrar el turno, lo que quedara pendiente se va con el", () => {
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "tarde");
    cerrarTurno("t1");
    expect(leerDireccion("t1")).toBeNull();
    // Y ya no se puede dirigir: el turno acabo.
    expect(dirigir("t1", "u1", "mas tarde")).toBe("no_existe");
  });

  it("un turno caducado no acepta correcciones", () => {
    // Un turno que muere sin cerrar dejaria su fila para siempre.
    abrirTurno("viejo", "u1", 1_000_000);
    abrirTurno("nuevo", "u1", 1_000_000 + 2 * 60 * 60 * 1000 + 60_000);
    expect(dirigir("viejo", "u1", "hola")).toBe("no_existe");
    expect(dirigir("nuevo", "u1", "hola")).toBe("ok");
  });

  it("🔴 un turno de 25 minutos sigue siendo dirigible (el de producción del 28/09)", () => {
    // Con la caducidad de 10 minutos de antes, abrir otro turno a los 25
    // barría éste: ni corregirlo ni pararlo a la mitad.
    abrirTurno("largo", "u1", 1_000_000);
    abrirTurno("otro", "u2", 1_000_000 + 25 * 60 * 1000);
    expect(dirigir("largo", "u1", "sigue")).toBe("ok");
  });

  it("BRAZO DE CONTROL: dos turnos a la vez no se pisan", () => {
    abrirTurno("a", "u1");
    abrirTurno("b", "u2");
    dirigir("a", "u1", "para a");
    dirigir("b", "u2", "para b");
    expect(leerDireccion("a")).toBe("para a");
    expect(leerDireccion("b")).toBe("para b");
  });
});

describe("parar el turno a propósito (■)", () => {
  it("cancelar llama a lo que aborta el turno, una vez", () => {
    let veces = 0;
    abrirTurno("t1", "u1", Date.now(), { abortar: () => (veces += 1) });
    expect(cancelar("t1", "u1")).toBe("ok");
    expect(veces).toBe(1);
  });

  it("🔴 un turno AJENO no se puede parar", () => {
    let veces = 0;
    abrirTurno("t1", "u1", Date.now(), { abortar: () => (veces += 1) });
    expect(cancelar("t1", "otro")).toBe("ajeno");
    expect(veces).toBe(0);
  });

  it("un turno que no existe, o que ya cerró, no se para", () => {
    expect(cancelar("fantasma", "u1")).toBe("no_existe");
    abrirTurno("t1", "u1", Date.now(), { abortar: () => {} });
    cerrarTurno("t1");
    expect(cancelar("t1", "u1")).toBe("no_existe");
  });

  it("cancelar no lo cierra: el turno sigue en el mapa hasta su `finally`", () => {
    // Quien cierra es la ruta, al terminar de escribir la fila. Si cancelar lo
    // quitara, una corrección enviada entre medias daría 404.
    abrirTurno("t1", "u1", Date.now(), { abortar: () => {} });
    cancelar("t1", "u1");
    expect(dirigir("t1", "u1", "ya da igual")).toBe("ok");
  });
});

describe("¿sigue vivo el turno de esta fila?", () => {
  it("devuelve el turno que escribe la fila, mientras está abierto", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "fila-1" });
    expect(turnoDeLaFila("fila-1", "u1")).toBe("t1");
    cerrarTurno("t1");
    expect(turnoDeLaFila("fila-1", "u1")).toBeNull();
  });

  it("🔴 la fila de otro usuario no existe", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "fila-1" });
    expect(turnoDeLaFila("fila-1", "otro")).toBeNull();
  });

  it("una fila que nadie escribe (el servidor se reinició) no tiene turno", () => {
    expect(turnoDeLaFila("huerfana", "u1")).toBeNull();
    expect(filaEnMarcha("huerfana")).toBe(false);
  });

  it("🔴 la fila de otro no es suya, pero SÍ está en marcha (un miembro la mira, no la corta)", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "fila-1" });
    expect(turnoDeLaFila("fila-1", "otro")).toBeNull();
    expect(filaEnMarcha("fila-1")).toBe(true);
    cerrarTurno("t1");
    expect(filaEnMarcha("fila-1")).toBe(false);
  });
});

// Pieza 3 de Len 2.5: ask_user_question espera la respuesta DENTRO del turno.
// Entra por otra petición (POST /api/agent/responder) y se encuentra con la
// herramienta que espera por este mismo almacén, como una corrección.
describe("la respuesta a una pregunta de Len, dentro del turno", () => {
  afterEach(() => vi.useRealTimers());
  const respuesta = [{ id: "plazo", selected: ["48 horas"] }];

  // Como DeepSeek («a browser that reconnects receives it again and can still
  // complete it»): al recargar con una pregunta en el aire, el reenganche
  // (`GET /api/agent/turno/<fila>`) la devuelve para pintar su tarjeta. Antes la
  // tarjeta no salía hasta que vencía la espera (ensayo de caja, 06/10).
  it("🔴 la pregunta que espera se puede volver a leer, y deja de estar al contestarla", async () => {
    abrirTurno("t1", "u1");
    const preguntas = [{ id: "plazo", question: "¿En cuánto tiempo?" }];
    expect(preguntaPendiente("t1", "u1")).toBeNull();
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000, preguntas });
    expect(preguntaPendiente("t1", "u1")).toEqual(preguntas);
    expect(preguntaPendiente("t1", "otro")).toBeNull();
    responder("t1", "u1", respuesta);
    await espera;
    expect(preguntaPendiente("t1", "u1")).toBeNull();
  });

  it("y también deja de estar cuando vence la espera", async () => {
    vi.useFakeTimers();
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 1000, preguntas: [{ id: "a", question: "¿?" }] });
    vi.advanceTimersByTime(1001);
    expect(await espera).toBeNull();
    expect(preguntaPendiente("t1", "u1")).toBeNull();
  });

  it("llega a quien espera", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(responder("t1", "u1", respuesta)).toBe("ok");
    expect(await espera).toEqual(respuesta);
  });

  it("🔴 el turno de otro no se contesta, y no se distingue de uno que no existe", async () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(responder("t1", "otro", respuesta)).toBe("ajeno");
    expect(responder("nadie", "u1", respuesta)).toBe("no_existe");
  });

  it("sin nadie esperando: sin_pregunta (el cliente lo manda como mensaje normal)", () => {
    abrirTurno("t1", "u1");
    expect(responder("t1", "u1", respuesta)).toBe("sin_pregunta");
  });

  it("🔴 la segunda respuesta a la misma pregunta es ya_respondida: se resuelve UNA vez", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(responder("t1", "u1", respuesta)).toBe("ok");
    expect(responder("t1", "u1", [{ id: "plazo", selected: ["Una semana"] }])).toBe("ya_respondida");
    expect(await espera).toEqual(respuesta);
  });

  it("LOTE 7-8 · descartar: quien espera recibe el descarte, no una respuesta", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(dismissQuestion("t1", "u1")).toBe("ok");
    expect(await espera).toBe(QUESTION_DISMISSED);
  });

  it("🔴 descartar: el turno de otro es ajeno; sin nadie esperando, sin_pregunta", () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(dismissQuestion("t1", "otro")).toBe("ajeno");
    expect(dismissQuestion("nadie", "u1")).toBe("no_existe");
    expect(dismissQuestion("t1", "u1")).toBe("ok");
    expect(dismissQuestion("t1", "u1")).toBe("sin_pregunta");
  });

  it("🔴 tras descartar, una respuesta no es ya_respondida: cae a mensaje (no se pierde un «Aprobar» tardío)", () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    dismissQuestion("t1", "u1");
    expect(responder("t1", "u1", respuesta)).toBe("sin_pregunta");
  });

  it("una forma que no vale es invalida y no resuelve", () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect(responder("t1", "u1", "48 horas")).toBe("invalida");
    expect(responder("t1", "u1", [{ id: "plazo", selected: "48 horas" }])).toBe("invalida");
    expect(responder("t1", "u1", [{ selected: [] }])).toBe("invalida");
    expect(responder("t1", "u1", respuesta)).toBe("ok");
  });

  it("🔴 lo escrito en «otra» es dato acotado: 5.000 caracteres llegan como 2.000", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    responder("t1", "u1", [{ id: "plazo", selected: [], custom: "x".repeat(5000) }]);
    expect(((await espera) as QuestionAnswer[])[0]?.custom?.length).toBe(2000);
  });

  it("vence con null a los timeoutMs, y después ya no hay pregunta que contestar", async () => {
    vi.useFakeTimers();
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await espera).toBeNull();
    expect(responder("t1", "u1", respuesta)).toBe("sin_pregunta");
  });

  it("el ■ la suelta al momento con null", async () => {
    abrirTurno("t1", "u1");
    const ac = new AbortController();
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000, signal: ac.signal });
    ac.abort();
    expect(await espera).toBeNull();
  });

  it("cerrar el turno la suelta con null", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    cerrarTurno("t1");
    expect(await espera).toBeNull();
  });

  it("sin turno abierto no hay a quién esperar: null", async () => {
    expect(await esperarRespuesta("nadie", { timeoutMs: 60_000 })).toBeNull();
  });
});

// PIEZA 8 · el encargo: quitarlo no puede pisar una ronda viva, y el chat que
// sondea una fila tiene que saber a qué ronda pasar.
describe("el encargo en el almacén", () => {
  it("un turno vivo del proyecto se ve, del dueño y de ese proyecto", () => {
    abrirTurno("t1", "u1", Date.now(), { projectId: "p1" });
    expect(turnoVivoDelProyecto("p1", "u1")).toBe(true);
    expect(turnoVivoDelProyecto("p2", "u1")).toBe(false);
    expect(turnoVivoDelProyecto("p1", "u2")).toBe(false);
    cerrarTurno("t1");
    expect(turnoVivoDelProyecto("p1", "u1")).toBe(false);
  });

  it("la ronda que siguió a una fila", () => {
    expect(siguienteDeLaFila("f1")).toBeNull();
    rondaSiguiente("f1", "f2");
    expect(siguienteDeLaFila("f1")).toBe("f2");
    _vaciarTodo();
    expect(siguienteDeLaFila("f1")).toBeNull();
  });
});

// Her ask_len corrects a running Len turn (spec local 2026-11-16-movil-es-tu-asistente, §5.4.8). A correction accepted
// after the loop's last look would be dropped by `cerrarTurno` — while her tool result says it reached Len (final
// review, I3): one that carries a fallback gets it when its turn closes unread.
describe("a correction that must not be lost", () => {
  beforeEach(() => _vaciarTodo());

  it("🔴 accepted but never read: its fallback runs when the turn closes", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "f1" });
    const fallback = vi.fn();
    expect(dirigir("t1", "u1", "mejor azul", { alCerrarSinLeer: fallback })).toBe("ok");
    cerrarTurno("t1");
    expect(fallback).toHaveBeenCalledWith("mejor azul");
  });

  it("read by the loop: no fallback", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "f1" });
    const fallback = vi.fn();
    dirigir("t1", "u1", "mejor azul", { alCerrarSinLeer: fallback });
    expect(leerDireccion("t1")).toBe("mejor azul");
    cerrarTurno("t1");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("a fallback that throws doesn't stop the turn from closing", () => {
    abrirTurno("t1", "u1", Date.now(), { filaId: "f1" });
    dirigir("t1", "u1", "x", { alCerrarSinLeer: () => { throw new Error("boom"); } });
    expect(() => cerrarTurno("t1")).not.toThrow();
    expect(turnoDeLaFila("f1", "u1")).toBeNull();
  });
});


// WHAT THE VISUALS SHARED, held by the open turn (spec local 2026-11-22-visuales-de-verdad, §2): the message brings them,
// a correction or an answer replaces them, and read_widget_context reads what is there now.
describe("the visual states of a running turn", () => {
  const A = { widgetId: "widget_aaaa1111", state: "3 of 5", cut: false, title: "dutch_exercises" };
  const B = { widgetId: "widget_bbbb2222", state: "5 of 5", cut: false, title: "dutch_exercises" };

  it("holds what was set, and a new set replaces it", () => {
    abrirTurno("t1", "u1");
    expect(visualStatesOf("t1")).toEqual([]);
    setVisualStates("t1", [A]);
    expect(visualStatesOf("t1")).toEqual([A]);
    setVisualStates("t1", [B]);
    expect(visualStatesOf("t1")).toEqual([B]);
  });

  it("an unknown or closed turn holds nothing", () => {
    setVisualStates("nope", [A]);
    expect(visualStatesOf("nope")).toEqual([]);
    abrirTurno("t1", "u1");
    setVisualStates("t1", [A]);
    cerrarTurno("t1");
    expect(visualStatesOf("t1")).toEqual([]);
  });

  it("remembers the visuals the turn drew, with their titles", () => {
    abrirTurno("t1", "u1");
    noteWidgetDrawn("t1", "widget_aaaa1111", "dutch_exercises");
    noteWidgetDrawn("t1", "widget_cccc3333", null);
    expect([...widgetsDrawnBy("t1")]).toEqual([["widget_aaaa1111", "dutch_exercises"], ["widget_cccc3333", null]]);
    expect(widgetsDrawnBy("nope").size).toBe(0);
  });

  it("tells its owner the turn's project and conversation, and nobody else", () => {
    abrirTurno("t1", "u1", Date.now(), { projectId: "p1", conversation: "assistant:a1" });
    abrirTurno("t2", "u1", Date.now(), { projectId: "p2" });
    expect(openTurnOf("t1", "u1")).toEqual({ projectId: "p1", conversation: "assistant:a1" });
    expect(openTurnOf("t2", "u1")).toEqual({ projectId: "p2", conversation: null });
    expect(openTurnOf("t1", "u2")).toBeNull();
    expect(openTurnOf("nope", "u1")).toBeNull();
  });
});
