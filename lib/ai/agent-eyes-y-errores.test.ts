import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  getQualityMetrics,
  recordAgentEyes,
  recordCriticRun,
  __resetQualityMetrics,
} from "./quality-metrics";

// ─── Los ojos del Agente, contados ─────────────────────────────────────────
//
// Los ojos fallan ABIERTOS por diseño (sin Chrome, sin key, timeout, JSON
// ilegible → veredicto "ok" con fallback=true). Hasta el 2026-09-01 la ruta
// del Agente sólo miraba `verdict.broken` y tiraba el flag, así que nada
// DENTRO del producto distinguía «miré y está bien» de «no pude mirar»: con
// Chrome caído, la verificación aprobaba todo en silencio y la única forma de
// enterarse era grepear el journal del box.
describe("recordAgentEyes", () => {
  beforeEach(() => __resetQualityMetrics());

  it("sin turnos verificados la tasa es null, no cero", () => {
    // Cero diría «ningún fallback», que es una afirmación. Null dice «todavía
    // no sé», que es la verdad.
    expect(getQualityMetrics().agentEyesFallbackRate).toBeNull();
  });

  it("cuenta el fallback y la rotura por separado", () => {
    recordAgentEyes({ fallback: false, broken: false });
    recordAgentEyes({ fallback: true, broken: false });
    recordAgentEyes({ fallback: false, broken: true });

    const m = getQualityMetrics();
    expect(m.agentEyes).toBe(3);
    expect(m.agentEyesFallbacks).toBe(1);
    expect(m.agentEyesBroken).toBe(1);
    expect(m.agentEyesFallbackRate).toBeCloseTo(1 / 3);
  });

  // 🔴 Lo que este contador existe para NO hacer: mezclarse con el crítico de
  // creación. `regenRate` se calcula sobre `totalGens`; si los turnos del
  // Agente entraran ahí, la tasa se diluiría con una superficie distinta y
  // dejaría de significar nada.
  it("NO toca los contadores del crítico de creación", () => {
    recordAgentEyes({ fallback: true, broken: false });
    const m = getQualityMetrics();
    expect(m.totalGens).toBe(0);
    expect(m.criticFallbacks).toBe(0);
    expect(m.regenRate).toBeNull();
  });

  it("y el crítico de creación tampoco toca los suyos", () => {
    recordCriticRun({ shouldRegenerate: true, fallback: true });
    const m = getQualityMetrics();
    expect(m.agentEyes).toBe(0);
    expect(m.criticFallbacks).toBe(1);
  });
});

// ─── Los errores que ve un usuario, en su idioma ───────────────────────────
//
// El panel pinta `error` TAL CUAL cuando es una cadena, así que
// `errorJson(413, "Page too large for an agent turn")` llegaba en inglés a los
// 10 locales. Desde el 2026-09-01 el servidor manda `code` y el cliente
// compone — la regla que ya estaba escrita en este repo y que aquí no se
// aplicaba.
//
// Esta prueba vigila la mitad que se rompe sola: una clave añadida en `es` y
// olvidada en `ja` es un fallo de next-intl EN TIEMPO DE EJECUCIÓN, en la cara
// del usuario.
//
// COMPLEMENTA a `components/claves-de-traduccion.test.ts`, no la duplica.
// Aquélla pregunta «¿pide un componente una clave que no existe?» y sólo lee
// `messages/en`; su punto ciego DECLARADO son las claves no literales, que es
// justo la forma que usa chat-panel para resolver un `code`. Ésta pregunta lo
// contrario —«¿existe la clave en los DIEZ?»— y sí ve el caso.
describe("las claves de error del chat existen en TODOS los locales", () => {
  const dir = path.join(process.cwd(), "messages");
  const locales = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const clavesDe = (loc: string): string[] => {
    const raw = readFileSync(path.join(dir, loc, "panelsChat.json"), "utf8");
    return Object.keys((JSON.parse(raw) as { errors?: Record<string, string> }).errors ?? {}).sort();
  };

  it("hay 10 locales y el lector los encuentra", () => {
    // Si un refactor mueve `messages/`, todo lo de abajo pasaría en vacío.
    expect(locales.length).toBe(10);
    expect(locales).toContain("es");
    expect(locales).toContain("ja");
  });

  // Los dos códigos que el servidor puede mandar hoy. Añadir uno nuevo en
  // `errorJson(...)` sin traducirlo cae aquí.
  for (const clave of ["pageTooLarge", "noTaggableElements"]) {
    it(`"${clave}" está en los 10`, () => {
      const faltan = locales.filter((l) => !clavesDe(l).includes(clave));
      expect(faltan).toEqual([]);
    });
  }

  it("y ningún locale tiene un juego de claves distinto del de `en`", () => {
    const patron = clavesDe("en");
    for (const loc of locales) {
      expect({ loc, claves: clavesDe(loc) }).toEqual({ loc, claves: patron });
    }
  });
});
