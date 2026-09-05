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
import { rateFor, usdDeTurno, usdTotal, VISION_RATE } from "./tarifas-eval";

const PRO = "accounts/fireworks/models/deepseek-v4-pro-0813";

describe("las tarifas salen de donde se cobra", () => {
  it("el Agente se cobra a la tarifa de Pro, no a la de Flash", () => {
    const pro = rateFor(PRO);
    const flash = rateFor("accounts/fireworks/models/deepseek-v4-flash-0731");
    expect(pro.input).toBeGreaterThan(flash.input);
    // El 6x medido el 2026-08-28. Cobrar Pro a precio de Flash escondía justo eso.
    expect(pro.input / flash.input).toBeCloseTo(6, 1);
  });

  it("un modelo desconocido se cobra al más caro que conocemos", () => {
    // Equivocarse hacia arriba detiene la batería antes de tiempo; hacia abajo,
    // vacía la cuenta.
    expect(rateFor("un-modelo-que-no-existe")).toEqual(VISION_RATE);
  });

  it("la parte cacheada cuesta MUCHO menos, y se descuenta de la de entrada", () => {
    const tarifa = rateFor(PRO);
    const todoFresco = usdDeTurno({ entrada: 100_000, cacheada: 0, salida: 0 }, tarifa);
    const casiTodoCache = usdDeTurno({ entrada: 100_000, cacheada: 90_000, salida: 0 }, tarifa);
    expect(casiTodoCache).toBeLessThan(todoFresco / 5);
  });
});

describe("el total de una corrida", () => {
  const tarifa = rateFor(PRO);
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
