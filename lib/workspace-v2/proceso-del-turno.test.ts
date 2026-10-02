import { describe, expect, it } from "vitest";

import { duracionLegible, partesDeLaDuracion, procesoDelTurno, type TurnoParaPlegar } from "./proceso-del-turno";

const bien: TurnoParaPlegar = { status: "applied", pasos: 3, startedAt: 1_000, appliedAt: 65_000 };

describe("procesoDelTurno — las reglas del pliegue de DeepSeek (la #13)", () => {
  it("cerrado con normalidad y con pasos: se pliega, con su duración", () => {
    expect(procesoDelTurno(bien)).toEqual({ plegable: true, duracionMs: 64_000 });
    // Deshecho después sigue siendo un turno que acabó bien.
    expect(procesoDelTurno({ ...bien, status: "reverted" })).toEqual({ plegable: true, duracionMs: 64_000 });
  });

  it("sin cerrar, detenido o fallido: los pasos a la vista, sin plegar", () => {
    expect(procesoDelTurno({ ...bien, status: "streaming" })).toEqual({ plegable: false });
    expect(procesoDelTurno({ ...bien, enServidor: true })).toEqual({ plegable: false });
    expect(procesoDelTurno({ ...bien, status: "error" })).toEqual({ plegable: false });
    expect(procesoDelTurno({ ...bien, cortado: true })).toEqual({ plegable: false });
    expect(procesoDelTurno({ ...bien, avisoTurno: "se cortó" })).toEqual({ plegable: false });
  });

  it("sin pasos no hay nada que plegar", () => {
    expect(procesoDelTurno({ ...bien, pasos: 0 })).toEqual({ plegable: false });
  });

  it("sin la hora de empezar (un turno recargado), la fila sin duración; nunca una negativa", () => {
    expect(procesoDelTurno({ status: "applied", pasos: 2, appliedAt: 65_000 })).toEqual({ plegable: true, duracionMs: null });
    expect(procesoDelTurno({ ...bien, startedAt: 70_000 })).toEqual({ plegable: true, duracionMs: null });
  });
});

describe("la duración, como DeepSeek", () => {
  it("desde un segundo, sin ceros, y con horas a partir de 60 minutos", () => {
    expect(partesDeLaDuracion(0)).toEqual({ seconds: 1 });
    expect(partesDeLaDuracion(42_400)).toEqual({ seconds: 42 });
    expect(partesDeLaDuracion(64_000)).toEqual({ minutes: 1, seconds: 4 });
    expect(partesDeLaDuracion(120_000)).toEqual({ minutes: 2 });
    expect(partesDeLaDuracion(3_720_000)).toEqual({ hours: 1, minutes: 2 });
  });

  it("en el idioma de quien lo mira", () => {
    expect(duracionLegible(64_000, "en")).toBe("1m 4s");
    expect(duracionLegible(64_000, "es")).toBe("1min 4s");
    expect(duracionLegible(42_000, "es")).toBe("42s");
  });
});
