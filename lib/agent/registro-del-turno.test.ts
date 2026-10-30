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
    const delivered = [{ name: "inventario.xlsx", url: "/api/projects/p1/deliveries/t1/ab12cd34-inventario.xlsx", size: 5 }];
    r.observar({ type: "action", tool: "present", status: "done", summary: "inventario.xlsx", delivered });
    expect(r.tarjetas[0]).toMatchObject({ tool: "present", delivered });
  });

  it("lo que vio Len: guarda las capturas del paso en su tarjeta", () => {
    const r = crearRegistroDelTurno();
    const screenshots = ["https://u/uploads/p1/screenshot-1.jpg"];
    r.observar({ type: "action", tool: "view_page", status: "done", summary: "", screenshots });
    expect(r.tarjetas[0]).toMatchObject({ tool: "view_page", screenshots });
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

  it("finalText is Len's last message: what it said after its last step, not the notes between steps", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "text", text: "I'll look at the code." });
    r.observar({ type: "action", tool: "Read", status: "running", summary: "" });
    r.observar({ type: "action", tool: "Read", status: "done", summary: "" });
    r.observar({ type: "text", text: "Found it. " });
    r.observar({ type: "text", text: "Fixing it." });
    r.observar({ type: "action", tool: "Edit", status: "done", summary: "" });
    r.observar({ type: "text", text: "Fixed: " });
    r.observar({ type: "text", text: "the list skipped a missing date." });
    expect(r.finalText).toBe("Fixed: the list skipped a missing date.");
    expect(r.texto).toContain("I'll look at the code.");
  });

  it("finalText: a turn that ends on a step keeps its last words, and a retry's discarded text never counts", () => {
    const r = crearRegistroDelTurno();
    expect(r.finalText).toBe("");
    r.observar({ type: "text", text: "Done, it loads." });
    r.observar({ type: "action", tool: "todo_write", status: "done", summary: "", todos: [] });
    expect(r.finalText).toBe("Done, it loads.");
    r.observar({ type: "text", text: "Half an attem" });
    r.observar({ type: "retry", attempt: 1, maxAttempts: 3, delayMs: 0, discardChars: 13 });
    expect(r.finalText).toBe("Done, it loads.");
    r.observar({ type: "text", text: "All good." });
    expect(r.finalText).toBe("All good.");
  });

  const base ={ terminalError: true, topeAlcanzado: null, errorCode: "cancelled" as const, mutoDurable: true };

  it("🔴 H05 · cortado a medias habiendo escrito: se guarda como cortado", () => {
    expect(corteDelTurno(base)).toBe("cancelled");
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "editar_html", status: "done", summary: "decks" });
    const fila = r.fila({ id: "t", userText: "x", page: null, toolResults: null, corte: corteDelTurno(base), mutoDurable: true });
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
    const fila = crearRegistroDelTurno().fila({ id: "t", userText: "x", page: null, toolResults: null, mutoDurable: false });
    expect(fila.status).toBe("applied");
  });

  // A Len Watch turn fixed /src/screens/Inicio.tsx in an app and its row said «No cambió nada de la app»:
  // an app's files change without an `html` event. The browser already decides this with
  // `laPaginaNoCambio`; the row the server writes (server-driven turns, a closed tab) now does too.
  it("noDocChange: a turn that wrote files without an html event did change something", () => {
    const r = crearRegistroDelTurno();
    r.observar({ type: "action", tool: "Edit", status: "done", summary: "/src/screens/Inicio.tsx" });
    expect(r.fila({ id: "t", userText: "x", page: null, toolResults: null, mutoDurable: true }).noDocChange).toBe(false);
    expect(crearRegistroDelTurno().fila({ id: "t", userText: "x", page: null, toolResults: null, mutoDurable: false }).noDocChange).toBe(true);
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
