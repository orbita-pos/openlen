import { describe, expect, it } from "vitest";
import { corteDelTurno, crearRegistroDelTurno } from "./registro-del-turno";

describe("la fila del turno que escribe el servidor", () => {
  const base = { terminalError: true, topeAlcanzado: null, errorCode: "cancelled" as const, mutoDurable: true };

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
