import { describe, expect, it } from "vitest";
import { corteDelTurno, crearRegistroDelTurno } from "./registro-del-turno";

describe("la fila del turno que escribe el servidor", () => {
  it("guarda la lista de todo_write en su tarjeta, también vacía", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "todo_write", status: "done", summary: "", todos: [{ content: "Inicio", status: "completed" }] });
    r.observar({ type: "action", tool: "todo_write", status: "done", summary: "", todos: [] });
    expect(r.tarjetas[0]).toMatchObject({ tool: "todo_write", todos: [{ content: "Inicio", status: "completed" }] });
    expect(r.tarjetas[1]).toMatchObject({ tool: "todo_write", todos: [] });
  });

  it("present: guarda los ficheros entregados en su tarjeta", () => {
    const r = crearRegistroDelTurno();
    const delivered = [{ name: "inventario.xlsx", url: "https://cdn.example/deliveries/p1/t1/inventario.xlsx", size: 5 }];
    r.observar({ type: "action", tool: "present", status: "done", summary: "inventario.xlsx", delivered });
    expect(r.tarjetas[0]).toMatchObject({ tool: "present", delivered });
  });

  it("LOS VISUALES: guarda el visual de show_widget y en qué punto del texto lo puso Len", () => {
    const r = crearRegistroDelTurno();
    const widget = { title: "visits_week", loadingMessages: ["Contando"], code: "<p>a</p>" };
    r.observar({ type: "text", text: "Mira:" });
    r.observar({ type: "action", tool: "show_widget", status: "done", summary: "", widget });
    expect(r.tarjetas[0]).toMatchObject({ tool: "show_widget", widget, textOffset: 5 });
  });

  it("LOS VISUALES: tras un reintento que descarta texto, el punto cuenta el texto ya recortado", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "text", text: "Hola, mira esto" });
    r.observar({ type: "retry", attempt: 1, maxAttempts: 3, delayMs: 0, discardChars: 10 });
    r.observar({ type: "action", tool: "show_widget", status: "done", summary: "", widget: { title: "", loadingMessages: [], code: "<p>" } });
    expect(r.tarjetas[0]).toMatchObject({ textOffset: 5 });
  });

  const base ={ terminalError: true, topeAlcanzado: null, errorCode: "cancelled" as const, mutoDurable: true };

  it("🔴 H05 · cortado a medias habiendo escrito: se guarda como cortado", () => {
    expect(corteDelTurno(base)).toBe("cancelled");
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "editar_html", status: "done", summary: "decks" });
    const fila = r.fila({ id: "t", userText: "x", page: null, toolResults: null, corte: corteDelTurno(base) });
    expect(fila.status).toBe("cortado");
    expect(fila.actions).toEqual([{ tool: "editar_html", status: "done", summary: "decks" }]);
  });

  it("BRAZO DE CONTROL: un tope NO es un corte — cierra con su propio resumen", () => {
    expect(corteDelTurno({ ...base, topeAlcanzado: "turn_limit" })).toBeNull();
  });

  it("…ni lo es un turno que se cayó sin haber escrito nada", () => {
    expect(corteDelTurno({ ...base, mutoDurable: false })).toBeNull();
  });

  it("…ni uno que terminó bien", () => {
    expect(corteDelTurno({ ...base, terminalError: false, errorCode: null })).toBeNull();
    const fila = crearRegistroDelTurno().fila({ id: "t", userText: "x", page: null, toolResults: null });
    expect(fila.status).toBe("applied");
  });

  it("un reintento retira de la fila lo que el intento fallido llegó a escribir", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "text", text: "Miro la página." });
    r.observar({ type: "text", text: "\n\n" });
    r.observar({ type: "text", text: "Ya v" });
    r.observar({ type: "retry", attempt: 1, maxAttempts: 5, delayMs: 500, discardChars: 6 });
    r.observar({ type: "text", text: "\n\n" });
    r.observar({ type: "text", text: "Ya está." });
    expect(r.texto).toBe("Miro la página.\n\nYa está.");
  });

  it("🔴 pieza 3: la tarjeta de la pregunta guarda sus opciones y lo que contestó el dueño (la lista es BLANCA)", () => {
    const r = crearRegistroDelTurno();
    const preguntas = [{ id: "plazo", question: "¿Cuánto tarda?", options: [{ label: "48 horas" }] }];
    r.observar({ type: "action", tool: "ask_user_question", status: "done", summary: "", pregunta: "¿Cuánto tarda?", preguntas, respuesta: "48 horas" });
    expect(r.tarjetas[0]).toMatchObject({ pregunta: "¿Cuánto tarda?", preguntas, respuesta: "48 horas" });
  });

  it("ALINEAR · la pregunta descartada guarda su marca de «cancelada»", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "exit_plan_mode", status: "done", summary: "", preguntas: [{ id: "plan-review", question: "?" }], dismissed: true });
    expect(r.tarjetas[0]).toMatchObject({ dismissed: true });
  });

  it("una compactación a media vuelta retira lo que el intento llegó a escribir; sin descarte, no toca nada", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "text", text: "Miro." });
    r.observar({ type: "compaction_start" });
    r.observar({ type: "compaction", pruned: 0, summarized: true, discardChars: 0 });
    r.observar({ type: "text", text: " Ya v" });
    r.observar({ type: "compaction", pruned: 1, summarized: true, discardChars: 5 });
    r.observar({ type: "text", text: " Ya está." });
    expect(r.texto).toBe("Miro. Ya está.");
  });
});
