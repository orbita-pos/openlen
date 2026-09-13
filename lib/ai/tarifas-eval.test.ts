// EL TOTAL QUE SE QUEDA CORTO NO DETIENE UNA CORRIDA — LA DEJA SEGUIR.
//
// El 2026-09-04 un `reduce` de scripts/sobre-ab.ts perdió su acumulador y
// durante una corrida entera imprimió el coste del ÚLTIMO turno como si fuera el
// total: $0,0091 contra $0,3415 reales, 37x menos. Nada falló, nada avisó, y el
// número salía con dos decimales y toda naturalidad.
//
// Por eso la suma vive en una función y por eso tiene esta prueba: el caso que
// la caza es el de DOS turnos distintos, que es justo el que un `reduce` roto
// pasa por alto devolviendo el segundo.
import { describe, expect, it } from "vitest";
import { creditRate } from "@/lib/credits";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import { MODELOS_TARIFADOS, rateFor, usdDeTurno, usdTotal, VISION_RATE } from "./tarifas-eval";

// 🔴 UN FIXTURE CONGELADO, NO LA TABLA VIVA — 2026-09-11. Aquí había un id de
// modelo (`deepseek-v4-pro-0813`) que se resolvía con `rateFor()`. Las pruebas
// de ARITMÉTICA que lo usan —que lo cacheado descuenta, y la reproducción del
// total que destapó el `reduce` roto— no hablan de qué modelo corre hoy:
// hablan de que la suma suma. Atarlas a la tabla viva las rompía en cada cambio
// de modelo sin que nada estuviera mal, y peor: cuando el papel `agent` pasó a
// v4.1 Flash, ese id dejó de estar en la tabla y `rateFor` caía al respaldo, o
// sea que la prueba medía OTRA cosa sin decirlo. Los números son los de Pro tal
// como estaban el 2026-08-28, que es el día de la corrida que se reproduce.
const TARIFA_PRO_HISTORICA = { input: 1.32, cached: 0.044, output: 3.96 } as const;

describe("las tarifas salen de donde se cobra", () => {
  // 🔴 2026-09-11 — LO QUE SE VIGILA ES EL VÍNCULO, NO EL NÚMERO. Esta prueba
  // decía «el Agente se cobra a la tarifa de Pro, no a la de Flash» y fijaba el
  // ratio 6x. Era correcta mientras el papel `agent` fuera Pro, y se puso roja
  // al cambiarlo a v4.1 Flash — que cuesta lo mismo que el razonador, así que
  // el 6x desapareció legítimamente. Fijar el número de nuevo sería volver a
  // atar la prueba a un modelo concreto. Lo que NO puede pasar nunca, corra
  // quien corra, es que el arnés tarifique el papel `agent` a un precio
  // distinto del que se le cobra al usuario: ése era el fallo original (se
  // cobraba Pro a precio de Flash) y es el que se afirma.
  it("el arnés tarifica el papel `agent` EXACTAMENTE a lo que se le cobra al usuario", () => {
    const delArnes = rateFor(MODEL_POLICY.agent.modelId);
    const delCobro = creditRate(MODEL_POLICY.agent.creditRate);
    expect(delArnes.input).toBe(delCobro.input);
    expect(delArnes.output).toBe(delCobro.output);
    expect(delArnes.cached).toBe(delCobro.cached ?? 0);
  });

  // 🔴 ESTA PRUEBA SUJETABA LA MENTIRA. Decía «al más caro que conocemos» y
  // comprobaba `toEqual(VISION_RATE)`: la IDENTIDAD de una constante, no la
  // propiedad que su propio nombre promete. Y la constante apuntaba a Gemini
  // (0,30 de entrada), que era la más BARATA de la tabla — 4,4x por debajo de
  // Pro, y hacia el lado que el comentario llama el peligroso. Verde todo el
  // tiempo, protegiendo lo contrario de lo que decía proteger.
  //
  // Ahora se comprueba la PROPIEDAD contra la tabla entera, así que no puede
  // volver a mentir cuando cambien las tarifas o entre un modelo nuevo.
  it("un modelo desconocido se cobra al más caro que conocemos", () => {
    const desconocido = rateFor("un-modelo-que-no-existe");
    expect(MODELOS_TARIFADOS.length).toBeGreaterThan(0);
    for (const id of MODELOS_TARIFADOS) {
      const conocida = rateFor(id);
      expect(desconocido.input).toBeGreaterThanOrEqual(conocida.input);
      expect(desconocido.cached).toBeGreaterThanOrEqual(conocida.cached);
      expect(desconocido.output).toBeGreaterThanOrEqual(conocida.output);
    }
  });

  // 🔴 LA TARIFA SIGUE A QUIEN CORRE — la misma regla que `EvalRunResult.modelId`
  // ya aplica al turno, y que `lib/agent/redesign.ts` aprendió cuando cobraba a
  // "gemini-flash" un rediseño que corría por Fireworks.
  //
  // Medido el 2026-09-07: `VISION_RATE` estaba fijo a `gemini-2.5-flash`
  // (0,30/2,50) mientras los ojos corrian en Qwen (0,40/1,60) desde el
  // 2026-08-28 —y desde el 2026-09-12 en `deepseek-v4p1-flash`, 0,22/0,66—. Entrada subestimada un 25%, salida sobreestimada un 56%, y
  // `usdTotal` alimenta `--max-mxn`. El OTRO arnés (`scripts/evals-pages.ts`)
  // ya lo hacía bien: una decisión en dos sitios y uno se quedó atrás.
  it("🔴 los ojos se cobran al modelo que de verdad mira, no a un proveedor retirado", () => {
    // Se pregunta a la politica: el literal `"qwen-vision"` que habia aqui
    // dejo de ser el de los ojos el 2026-09-12.
    const ojos = creditRate(MODEL_POLICY.visualCritic.creditRate);
    expect(VISION_RATE.input).toBe(ojos.input);
    expect(VISION_RATE.output).toBe(ojos.output);
    expect(VISION_RATE).toEqual(rateFor(MODEL_POLICY.visualCritic.modelId));
  });

  // La tabla no puede tarifar un modelo que ningún papel puede correr: una fila
  // así se lee como una alternativa que existe, y encima puede acabar siendo el
  // respaldo de `rateFor` sin que nadie lo decida — que es justo lo que pasó.
  it("sólo tarifa modelos que la política nombra", () => {
    const corriendo = new Set([
      MODEL_POLICY.reasoner.modelId,
      MODEL_POLICY.visualCritic.modelId,
      MODEL_POLICY.agent.modelId,
    ]);
    expect([...MODELOS_TARIFADOS].sort()).toEqual([...corriendo].sort());
  });

  it("la parte cacheada cuesta MUCHO menos, y se descuenta de la de entrada", () => {
    const tarifa = TARIFA_PRO_HISTORICA;
    const todoFresco = usdDeTurno({ entrada: 100_000, cacheada: 0, salida: 0 }, tarifa);
    const casiTodoCache = usdDeTurno({ entrada: 100_000, cacheada: 90_000, salida: 0 }, tarifa);
    expect(casiTodoCache).toBeLessThan(todoFresco / 5);
  });
});

describe("el total de una corrida", () => {
  const tarifa = TARIFA_PRO_HISTORICA;
  const uno = { entrada: 10_000, cacheada: 5_000, salida: 100 };
  const dos = { entrada: 60_000, cacheada: 40_000, salida: 900 };

  // 🔴 LA PRUEBA QUE CAZA EL FALLO MEDIDO: un acumulador perdido devuelve el
  // ÚLTIMO, no la suma. Con dos turnos DISTINTOS los dos números se separan.
  it("suma TODOS los turnos, no devuelve el último", () => {
    const total = usdTotal([uno, dos], tarifa);
    expect(total).toBeCloseTo(usdDeTurno(uno, tarifa) + usdDeTurno(dos, tarifa), 10);
    expect(total).toBeGreaterThan(usdDeTurno(dos, tarifa));
  });

  it("ni el primero", () => {
    expect(usdTotal([uno, dos], tarifa)).toBeGreaterThan(usdDeTurno(uno, tarifa));
  });

  it("una corrida vacía cuesta cero", () => {
    expect(usdTotal([], tarifa)).toBe(0);
  });

  // El número real de la corrida del 2026-09-04, para que esta prueba también
  // sea el registro de lo que pasó: 12 turnos, $0,3415 — no los $0,0091 que se
  // imprimieron.
  it("reproduce el total de la corrida que destapó el fallo", () => {
    const doce = [
      { entrada: 66_212, cacheada: 43_780, salida: 572 },
      { entrada: 10_902, cacheada: 5_245, salida: 388 },
      { entrada: 155_643, cacheada: 117_394, salida: 2_245 },
      { entrada: 48_225, cacheada: 33_453, salida: 2_350 },
      { entrada: 44_314, cacheada: 21_806, salida: 628 },
      { entrada: 10_897, cacheada: 5_235, salida: 334 },
      { entrada: 43_975, cacheada: 21_816, salida: 313 },
      { entrada: 10_903, cacheada: 5_245, salida: 398 },
      { entrada: 155_993, cacheada: 117_403, salida: 2_498 },
      { entrada: 46_143, cacheada: 31_771, salida: 2_501 },
      { entrada: 44_286, cacheada: 35_700, salida: 613 },
      { entrada: 10_906, cacheada: 5_235, salida: 346 },
    ];
    expect(usdTotal(doce, tarifa)).toBeCloseTo(0.3415, 3);
    // Y NO el último, que es lo que se imprimió.
    expect(usdDeTurno(doce[doce.length - 1], tarifa)).toBeCloseTo(0.0091, 4);
  });
});
