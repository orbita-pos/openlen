import { describe, expect, it } from "vitest";
import { RUTA_MEMORIA_DUENO, RUTA_MEMORIA_PROYECTO, alcanceDeRuta, lineasNuevas } from "./memoria";

describe("la memoria como ficheros (H3): sólo se AÑADE", () => {
  it("dos ficheros, uno por alcance", () => {
    expect(alcanceDeRuta(RUTA_MEMORIA_DUENO)).toBe("siempre");
    expect(alcanceDeRuta(RUTA_MEMORIA_PROYECTO)).toBe("esta_pagina");
    expect(alcanceDeRuta("/index.html")).toBeNull();
  });

  it("las líneas nuevas salen sin viñeta, y lo guardado sigue ahí", () => {
    const antes = "— Lo que sé de ti —\n• Háblale de tú";
    const despues = "— Lo que sé de ti —\n• Háblale de tú\n• Nunca uses amarillo\n- Sé breve";
    expect(lineasNuevas(antes, despues, RUTA_MEMORIA_DUENO)).toEqual({ ok: true, nuevas: ["Nunca uses amarillo", "Sé breve"] });
  });

  it("desde vacío también", () => {
    expect(lineasNuevas("", "• Háblale de tú\n", RUTA_MEMORIA_DUENO)).toEqual({ ok: true, nuevas: ["Háblale de tú"] });
  });

  it("🔴 quitar o cambiar una línea guardada es decisión del USUARIO: error, y no se guarda nada", () => {
    const antes = "• Háblale de tú\n• Nunca uses amarillo";
    const r = lineasNuevas(antes, "• Háblale de usted\n• Nunca uses amarillo", RUTA_MEMORIA_DUENO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("«• Háblale de tú»");
      expect(r.error).toContain("the user's decision");
    }
  });

  it("el marcador del bloque no es una preferencia nueva", () => {
    expect(lineasNuevas("", "— Preferencias guardadas por el agente —\n• Tono formal", RUTA_MEMORIA_PROYECTO)).toEqual({
      ok: true,
      nuevas: ["Tono formal"],
    });
  });
});
