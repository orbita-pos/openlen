// lib/agent/dynamis.test.ts — Len Dynamis llega del cuerpo del turno a lo que lee el modelo.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentMessages } from "./context";
import { dynamisAvailable, modeOfTurn } from "./dynamis";

const CON = { OPENLEN_TERMINAL: "1" };
const SIN = {};

describe("el modo del turno, saneado en la ruta", () => {
  it("sólo el literal \"dynamis\", y sólo con la terminal encendida", () => {
    expect(modeOfTurn("dynamis", CON)).toBe("dynamis");
    for (const raro of [undefined, null, "", "Dynamis", " dynamis", "len", "max", 1, true, { mode: "dynamis" }]) {
      expect(modeOfTurn(raro, CON)).toBe("len");
    }
  });

  it("con la terminal apagada no existe: el turno es de Len y el panel no lo ofrece", () => {
    expect(modeOfTurn("dynamis", SIN)).toBe("len");
    expect(modeOfTurn("dynamis", { OPENLEN_TERMINAL: "0" })).toBe("len");
    expect(dynamisAvailable(SIN)).toBe(false);
    expect(dynamisAvailable(CON)).toBe(true);
  });
});

// Lo que de verdad sale hacia el modelo: el prompt de sistema y el manual que
// el arnés adjunta detrás, armados por `buildAgentMessages`, el mismo camino
// que la ruta y el arnés de evals.
describe("el mensaje que se manda, según el modo", () => {
  afterEach(() => vi.unstubAllEnvs());
  const armar = (mode?: "len" | "dynamis") => {
    const r = buildAgentMessages({
      state: {},
      userBrief: null,
      history: [],
      prompt: "hola",
      maxPromptTokens: 60_000,
      ...(mode ? { mode } : {}),
    });
    if (!r.ok) throw new Error("no cupo");
    return JSON.stringify(r.messages);
  };

  it("en Dynamis, ni el prompt ni el manual nombran Read, Edit ni Write", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    expect(armar("dynamis")).not.toMatch(/\b(Read|Edit|Write|Grep|Glob)\b(?!-)/);
  });

  it("BRAZO DE CONTROL: en Len, con la misma terminal, sí los nombra", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    expect(armar("len")).toMatch(/\bEdit\b/);
    expect(armar()).toBe(armar("len"));
  });

  it("sin la terminal, el modo no cambia ni un byte", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "");
    expect(armar("dynamis")).toBe(armar());
  });
});
