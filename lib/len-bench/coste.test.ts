// lib/len-bench/coste.test.ts
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rateFor, usdDeTurno } from "@/lib/ai/tarifas-eval";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import {
  centimosDelEstimado,
  esperarUsdDeProyecto,
  estimadoExcedeTope,
  tarifaDelModelo,
  USD_POR_TURNO_ESTIMADO,
  usdDeGrabacion,
  usdDeProyecto,
} from "./coste";

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

describe("esperarUsdDeProyecto — la ruta graba DESPUÉS de cerrar el stream", () => {
  const id = MODEL_POLICY.agent.modelId;
  const rapido = { plazoMs: 400, pausaMs: 20 };
  const usd1000 = () => usdDeTurno({ entrada: 1000, cacheada: 0, salida: 0 }, T());

  it("espera a que aparezca la grabación y la cuenta", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-espera-"));
    setTimeout(() => fs.writeFileSync(path.join(dir, "2026-a-p1.json"), JSON.stringify(grabacion(id, [[uso(1000, 0, 0)]]))), 60);
    const r = await esperarUsdDeProyecto(dir, "p1", rapido);
    expect(r.aviso).toBeUndefined();
    expect(r.usd).toBeCloseTo(usd1000(), 12);
  });

  it("un JSON a medio escribir se vuelve a mirar, no se cuenta como roto", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-espera-"));
    const f = path.join(dir, "2026-a-p1.json");
    const entero = JSON.stringify(grabacion(id, [[uso(1000, 0, 0)]]));
    fs.writeFileSync(f, entero.slice(0, 20));
    setTimeout(() => fs.writeFileSync(f, entero), 60);
    expect((await esperarUsdDeProyecto(dir, "p1", rapido)).usd).toBeCloseTo(usd1000(), 12);
  });

  it("si no aparece, cuenta el estimado y lo DICE: el tope no se puede quedar corto en silencio", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-espera-"));
    const r = await esperarUsdDeProyecto(dir, "p1", rapido);
    expect(r.usd).toBe(USD_POR_TURNO_ESTIMADO);
    expect(r.aviso).toMatch(/no apareció la grabación del turno/);
  });

  it("un modelo sin tarifa no se espera: falla ruidoso, como en el informe", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-espera-"));
    fs.writeFileSync(path.join(dir, "2026-a-p1.json"), JSON.stringify(grabacion("accounts/fireworks/models/otro", [[uso(1, 0, 0)]])));
    await expect(esperarUsdDeProyecto(dir, "p1", rapido)).rejects.toThrow(/no tiene tarifa/);
  });
});

// El estimado del corredor es `turnos × 0,01 × 1,5`, y así se calcula aquí:
// con la MISMA aritmética de coma flotante, no con el número ya limpio.
const estimadoDe = (turnos: number) => turnos * 0.01 * 1.5;

describe("el estimado contra el tope, en céntimos", () => {
  // El caso del 2026-09-30: 4 encargos, 5 pasos, 20 turnos → 0,30000000000000004.
  it("🔴 un tope IGUAL al estimado que se imprime pasa", () => {
    expect(estimadoDe(20)).toBeGreaterThan(0.3); // el ruido existe
    expect(estimadoExcedeTope(estimadoDe(20), 0.3)).toBe(false);
  });

  // CONTRA-PRUEBA: el arreglo no puede dejar pasar un tope que SÍ se queda corto.
  it("un tope un céntimo por debajo sigue rechazándose", () => {
    expect(estimadoExcedeTope(estimadoDe(20), 0.29)).toBe(true);
  });

  // 3 turnos = 0,045, que `toFixed(2)` imprime 0,04: el pesimista salía a la baja.
  it("el medio céntimo se redondea hacia ARRIBA", () => {
    expect(centimosDelEstimado(estimadoDe(3))).toBe(5);
    expect(estimadoExcedeTope(estimadoDe(3), 0.04)).toBe(true);
    expect(estimadoExcedeTope(estimadoDe(3), 0.05)).toBe(false);
  });

  it("y el ruido de la coma flotante no inventa un céntimo", () => {
    expect(centimosDelEstimado(estimadoDe(20))).toBe(30);
    expect(centimosDelEstimado(estimadoDe(36))).toBe(54);
  });
});
