// lib/len-bench/coste.test.ts
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rateFor, usdDeTurno } from "@/lib/ai/tarifas-eval";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import { tarifaDelModelo, usdDeGrabacion, usdDeProyecto } from "./coste";

const T = () => rateFor(MODEL_POLICY.agent.modelId);

const uso = (inputTokens: number, cachedTokens: number, outputTokens: number) =>
  ({ type: "usage", inputTokens, cachedTokens, outputTokens, thinkingTokens: 0 }) as const;

const grabacion = (modelId: string, turnos: unknown[][]) => ({
  formato: 1,
  grabadoEn: "2026-09-24T00:00:00.000Z",
  meta: { modelId, requestId: "p1" },
  messages: [],
  turnos,
});

describe("tarifaDelModelo", () => {
  it("es la tarifa del modelo que grabó el turno", () => {
    expect(tarifaDelModelo(MODEL_POLICY.agent.modelId)).toEqual(T());
  });
  it("un modelo sin tarifa se DENUNCIA: un informe no puede cobrar al más caro en silencio", () => {
    expect(() => tarifaDelModelo("accounts/fireworks/models/otro")).toThrow(/no tiene tarifa/);
  });
});

describe("usdDeGrabacion / usdDeProyecto", () => {
  it("suma los eventos de uso de todas las llamadas, cierre incluido", () => {
    const id = MODEL_POLICY.agent.modelId;
    const g = { ...grabacion(id, [[uso(1000, 0, 100)], [uso(2000, 1000, 50)]]), cierre: [uso(500, 0, 10)] };
    const esperado =
      usdDeTurno({ entrada: 1000, cacheada: 0, salida: 100 }, T()) +
      usdDeTurno({ entrada: 2000, cacheada: 1000, salida: 50 }, T()) +
      usdDeTurno({ entrada: 500, cacheada: 0, salida: 10 }, T());
    expect(usdDeGrabacion(g as never)).toBeCloseTo(esperado, 12);
  });
  it("sólo lee las grabaciones de ESE proyecto", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-coste-"));
    const id = MODEL_POLICY.agent.modelId;
    fs.writeFileSync(path.join(dir, "2026-a-proyectoA.json"), JSON.stringify(grabacion(id, [[uso(1000, 0, 0)]])));
    fs.writeFileSync(path.join(dir, "2026-b-proyectoB.json"), JSON.stringify(grabacion(id, [[uso(9000, 0, 0)]])));
    const r = usdDeProyecto(dir, "proyectoA");
    expect(r.grabaciones).toBe(1);
    expect(r.usd).toBeCloseTo(usdDeTurno({ entrada: 1000, cacheada: 0, salida: 0 }, T()), 12);
  });
});
