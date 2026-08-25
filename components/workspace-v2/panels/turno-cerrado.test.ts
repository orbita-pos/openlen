// Hallazgo 4B — «Chat y Len pueden mutar la página de forma durable y terminar
// como un fallo puro». Esta es la mitad del cliente: la decisión de pintar rojo
// o cerrar aplicado-con-aviso.
import { describe, expect, it } from "vitest";
import { cierreDeTurno } from "./turno-cerrado";

describe("cierreDeTurno", () => {
  it("sin error, el turno cierra aplicado y sin aviso", () => {
    expect(
      cierreDeTurno({
        errorMessage: null,
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({ kind: "aplicado" });
  });

  // ── El hallazgo ──────────────────────────────────────────────────────────
  it("un 503 DESPUÉS de guardar cierra aplicado, con el motivo a la vista", () => {
    expect(
      cierreDeTurno({
        errorMessage: "El agente se quedó sin espacio de respuesta.",
        mutoDurable: true,
        hayDocumentoNuevo: true,
      }),
    ).toEqual({
      kind: "aplicado-con-aviso",
      aviso: "El agente se quedó sin espacio de respuesta.",
    });
  });

  // Un cambio de AJUSTES (módulo, tema, motion, música, 3D, datos vivos) es
  // igual de durable y NO emite documento: el cliente sólo lo sabe porque el
  // servidor se lo dice.
  it("un cambio de AJUSTES cuenta aunque no haya documento nuevo", () => {
    const r = cierreDeTurno({
      errorMessage: "Gemini 503",
      mutoDurable: true,
      hayDocumentoNuevo: false,
    });
    expect(r.kind).toBe("aplicado-con-aviso");
  });

  // Y al revés: si el terminal nunca llegó (la ruta reventó tras pintar el
  // documento), el html que YA se pintó es prueba suficiente.
  it("un documento pintado basta aunque el servidor no llegue a decirlo", () => {
    const r = cierreDeTurno({
      errorMessage: "Unknown error",
      mutoDurable: false,
      hayDocumentoNuevo: true,
    });
    expect(r.kind).toBe("aplicado-con-aviso");
  });

  // ── CONTRA-PRUEBA ────────────────────────────────────────────────────────
  // El arreglo NO puede convertir cualquier fallo en «aplicado». Un turno que
  // no llegó a tocar nada sigue siendo un fallo puro y se pinta rojo, con su
  // botón de reintentar — que ahí sí es lo correcto.
  it("CONTRA-PRUEBA: un fallo SIN mutación sigue siendo rojo", () => {
    expect(
      cierreDeTurno({
        errorMessage: "El agente fue cancelado.",
        mutoDurable: false,
        hayDocumentoNuevo: false,
      }),
    ).toEqual({ kind: "error", texto: "El agente fue cancelado." });
  });
});
