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
});
