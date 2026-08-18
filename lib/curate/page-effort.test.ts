import { describe, expect, it } from "vitest";

import {
  ACCEPTED_MUTATION_CEILING,
  DEFAULT_PAGE_EFFORT,
  SESSION_TURN_CEILING,
  effortProfile,
  isPageEffort,
  type PageEffort,
} from "./page-effort";

const LEVELS: readonly PageEffort[] = ["low", "medium", "high"];

describe("niveles de esfuerzo", () => {
  // Ya no es idéntico a lo que corría antes del dial: con un solo turno de
  // reparación el modelo lo gastaba mirando la página y 7 de 9 reparaciones
  // medidas no tocaron nada. Todo lo demás del nivel sigue pinchado.
  it("el nivel por defecto sigue siendo el más barato, con turno para actuar", () => {
    expect(DEFAULT_PAGE_EFFORT).toBe("low");
    expect(effortProfile("low")).toEqual({
      sessionTurns: 4,
      acceptedMutations: 12,
      reviewRounds: 1,
      repairTurns: 2,
    });
  });

  // Mirar y actuar no caben en un turno, y una reparación que sólo mira es
  // dinero gastado en nada.
  it("ningún nivel compra una reparación que sólo alcanza a mirar", () => {
    for (const level of LEVELS) expect(effortProfile(level).repairTurns).toBeGreaterThanOrEqual(2);
  });

  it("cada nivel compra al menos tanto como el anterior", () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      const prev = effortProfile(LEVELS[i - 1]);
      const next = effortProfile(LEVELS[i]);
      expect(next.sessionTurns).toBeGreaterThanOrEqual(prev.sessionTurns);
      expect(next.acceptedMutations).toBeGreaterThanOrEqual(prev.acceptedMutations);
      expect(next.reviewRounds).toBeGreaterThanOrEqual(prev.reviewRounds);
      expect(next.repairTurns).toBeGreaterThanOrEqual(prev.repairTurns);
    }
  });

  it("subir de nivel cambia algo en todos los pares", () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(effortProfile(LEVELS[i])).not.toEqual(effortProfile(LEVELS[i - 1]));
    }
  });

  // Los techos que la sesión aplica salen de la tabla. Escritos a mano, añadir
  // un nivel mas caro lo dejaria mordido por un tope viejo y el dial mentiria.
  it("los techos alcanzan al nivel más caro", () => {
    for (const level of LEVELS) {
      expect(effortProfile(level).sessionTurns).toBeLessThanOrEqual(SESSION_TURN_CEILING);
      expect(effortProfile(level).acceptedMutations).toBeLessThanOrEqual(ACCEPTED_MUTATION_CEILING);
    }
    expect(SESSION_TURN_CEILING).toBe(effortProfile("high").sessionTurns);
    expect(ACCEPTED_MUTATION_CEILING).toBe(effortProfile("high").acceptedMutations);
  });

  it("sin nivel, el perfil es el de siempre", () => {
    expect(effortProfile()).toEqual(effortProfile(DEFAULT_PAGE_EFFORT));
  });

  it.each([["low"], ["medium"], ["high"]])("reconoce %s", (value) => {
    expect(isPageEffort(value)).toBe(true);
  });

  it.each([["max"], [""], ["LOW"], [null], [undefined], [3], [{}]])(
    "rechaza %p sin lanzar",
    (value) => {
      expect(isPageEffort(value)).toBe(false);
    },
  );

  it("las tablas son inmutables — un nivel no puede reescribir a otro", () => {
    const profile = effortProfile("low") as { sessionTurns: number };
    expect(() => { profile.sessionTurns = 99; }).toThrow();
    expect(effortProfile("low").sessionTurns).toBe(4);
  });
});
