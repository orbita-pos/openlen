import { describe, expect, it } from "vitest";

import {
  CONDICION_MAX,
  SISTEMA_EVALUADOR,
  evaluarCondicion,
  leerVeredicto,
  promptDeEvaluacion,
} from "./evaluar-condicion";

describe("lo que se le manda al evaluador", () => {
  const hecho = () =>
    promptDeEvaluacion({
      condicion: "la página no desborda en móvil",
      transcript: "AGENTE: ya lo arreglé",
    });

  it("lleva el transcript y la condición", () => {
    expect(hecho()).toContain("AGENTE: ya lo arreglé");
    expect(hecho()).toContain("Condición: la página no desborda en móvil");
  });

  it("le dice que juzgue SÓLO con el transcript", () => {
    expect(hecho()).toMatch(/SÓLO la evidencia|SÓLO en la evidencia/i);
  });

  // 🔴 LA REGLA QUE HACE QUE ESTO VALGA ALGO. Sin ella el evaluador se cree el
  // relato del agente, y entonces no estamos evaluando: estamos preguntándole
  // al que ya decidió que estaba hecho si está hecho.
  it("🔴 le prohíbe tomar la afirmación del agente como evidencia", () => {
    expect(SISTEMA_EVALUADOR).toMatch(/NO ES EVIDENCIA/);
    expect(SISTEMA_EVALUADOR).toMatch(/resultados de herramienta/i);
  });

  it("nombra las tres salidas, no dos", () => {
    for (const v of ["cumplida", "no_cumplida", "imposible"]) {
      expect(SISTEMA_EVALUADOR).toContain(v);
    }
  });
});

describe("cómo se lee su respuesta", () => {
  it("lee el JSON limpio", () => {
    expect(leerVeredicto('{"veredicto":"cumplida","razon":"el render no reporta desbordes"}')).toEqual({
      veredicto: "cumplida",
      razon: "el render no reporta desbordes",
    });
  });

  it("y el JSON envuelto en prosa", () => {
    expect(leerVeredicto('Aquí va: {"veredicto":"imposible","razon":"no hay pasarela"} listo')?.veredicto).toBe(
      "imposible",
    );
  });

  // 🔴 EL FALLO NO CAE DEL LADO DE «CUMPLIDA». Un evaluador que no se entiende
  // dejaría pasar por bueno un turno a medias, que es exactamente la avería que
  // este mecanismo viene a cerrar.
  it.each([
    ["basura", "no soy JSON"],
    ["veredicto inventado", '{"veredicto":"casi","razon":"x"}'],
    ["sin veredicto", '{"razon":"x"}'],
    ["JSON roto", '{"veredicto":"cumplida"'],
  ])("%s no se lee como cumplida", (_, raw) => {
    expect(leerVeredicto(raw)).toBeNull();
  });
});

describe("las puertas que no gastan un turno", () => {
  it("una condición vacía no llega al modelo", async () => {
    await expect(evaluarCondicion({ condicion: "   ", transcript: "x" })).resolves.toEqual({
      ok: false,
      motivo: "condicion_vacia",
    });
  });

  // El tope del binario, y por su misma razón: el usuario tiene que poder leer
  // la condición entera en el diálogo de aprobación.
  it("una condición más larga que el tope tampoco", async () => {
    const larga = "x".repeat(CONDICION_MAX + 1);
    await expect(evaluarCondicion({ condicion: larga, transcript: "x" })).resolves.toEqual({
      ok: false,
      motivo: "condicion_larga",
    });
  });
});
