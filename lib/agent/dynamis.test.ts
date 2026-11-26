// lib/agent/dynamis.test.ts — Len Dynamis llega del cuerpo del turno a lo que lee el modelo.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentMessages } from "./context";
import { dynamisAvailable, modeOfTurn, odysseyPlanAllowed, odysseyUserAllowed } from "./dynamis";

const CON = { OPENLEN_TERMINAL: "1", OPENLEN_DYNAMIS: "1" };
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
    expect(modeOfTurn("dynamis", { OPENLEN_TERMINAL: "0", OPENLEN_DYNAMIS: "1" })).toBe("len");
    expect(dynamisAvailable(SIN)).toBe(false);
    expect(dynamisAvailable(CON)).toBe(true);
  });

  // 🔴 APARCADO (03/10/2026). Len 2.5 sale con la terminal encendida, y ESO
  // solo no puede traer el selector de Odyssey al chat de todos.
  it("aparcado: con la terminal encendida pero sin OPENLEN_DYNAMIS=1, no existe", () => {
    expect(dynamisAvailable({ OPENLEN_TERMINAL: "1" })).toBe(false);
    expect(modeOfTurn("dynamis", { OPENLEN_TERMINAL: "1" })).toBe("len");
    for (const raro of ["", "0", "true", "yes", " 2"]) {
      expect(dynamisAvailable({ OPENLEN_TERMINAL: "1", OPENLEN_DYNAMIS: raro })).toBe(false);
    }
  });

  it("exige plan Max o Ultra salvo cuenta autorizada en OPENLEN_ODYSSEY_ONLY_USERS / OPENLEN_SANDBOX_ONLY_USERS", () => {
    expect(odysseyPlanAllowed("free")).toBe(false);
    expect(odysseyPlanAllowed("pro")).toBe(false);
    expect(odysseyPlanAllowed("max")).toBe(true);
    expect(odysseyPlanAllowed("ultra")).toBe(true);

    expect(modeOfTurn("dynamis", CON, { plan: "free", userId: "u1" })).toBe("len");
    expect(modeOfTurn("dynamis", CON, { plan: "pro", userId: "u1" })).toBe("len");
    expect(modeOfTurn("dynamis", CON, { plan: "max", userId: "u1" })).toBe("dynamis");
    expect(modeOfTurn("dynamis", CON, { plan: "ultra", userId: "u1" })).toBe("dynamis");

    const vipEnv = { ...CON, OPENLEN_ODYSSEY_ONLY_USERS: "u-vip, u-qa" };
    expect(odysseyUserAllowed({ plan: "free", userId: "u-vip" }, vipEnv)).toBe(true);
    expect(modeOfTurn("dynamis", vipEnv, { plan: "free", userId: "u-vip" })).toBe("dynamis");
    expect(modeOfTurn("dynamis", vipEnv, { plan: "free", userId: "u-other" })).toBe("len");
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
      history: [],
      prompt: "hola",
      maxPromptTokens: 60_000,
      ...(mode ? { mode } : {}),
    });
    if (!r.ok) throw new Error("no cupo");
    return JSON.stringify(r.messages);
  };

  it("en Dynamis conserva Read, Edit y Write, incluye la guía de run_code y deja Len normal intacto", () => {
    vi.stubEnv("OPENLEN_TERMINAL", "1");
    expect(armar("dynamis")).toMatch(/\bEdit\b/);
    expect(armar("dynamis")).toMatch(/\brun_code\b/);
    expect(armar("len")).not.toMatch(/\brun_code\b/);
    expect(armar()).toBe(armar("len"));
  });

  it("sin la terminal, el modo tampoco cambia ni un byte", () => {
    // Encendida por defecto desde N45: apagarla es el literal "0".
    vi.stubEnv("OPENLEN_TERMINAL", "0");
    expect(armar("dynamis")).toBe(armar());
  });
});
