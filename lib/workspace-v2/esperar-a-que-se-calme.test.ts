import { describe, expect, it } from "vitest";
import { esperarAQueSeCalme } from "@/lib/workspace-v2/esperar-a-que-se-calme";

/** Reloj y siesta falsos: la prueba no espera de verdad ni un milisegundo. */
function banco() {
  let t = 0;
  const dormido: number[] = [];
  return {
    ahora: () => t,
    dormir: async (ms: number) => {
      dormido.push(ms);
      t += ms;
    },
    get total() {
      return t;
    },
    get siestas() {
      return dormido.length;
    },
  };
}

describe("esperarAQueSeCalme", () => {
  it("si ya está tranquilo no duerme nada", async () => {
    const b = banco();
    const calmado = await esperarAQueSeCalme(() => false, {
      topeMs: 5000,
      pasoMs: 150,
      ahora: b.ahora,
      dormir: b.dormir,
    });
    expect(calmado).toBe(true);
    expect(b.siestas).toBe(0);
  });

  it("espera lo justo y sigue en cuanto se calma", async () => {
    const b = banco();
    // Ocupado los primeros 400ms, tranquilo después.
    const calmado = await esperarAQueSeCalme(() => b.ahora() < 400, {
      topeMs: 5000,
      pasoMs: 150,
      ahora: b.ahora,
      dormir: b.dormir,
    });
    expect(calmado).toBe(true);
    expect(b.total).toBe(450);
    expect(b.siestas).toBe(3);
  });

  it("🔴 se rinde en el tope y lo DICE — no miente diciendo que se calmó", async () => {
    const b = banco();
    const calmado = await esperarAQueSeCalme(() => true, {
      topeMs: 600,
      pasoMs: 150,
      ahora: b.ahora,
      dormir: b.dormir,
    });
    expect(calmado).toBe(false);
    // No se pasa del tope: es un presupuesto, no una sugerencia.
    expect(b.total).toBeLessThanOrEqual(600);
  });

  it("un tope de cero pregunta UNA vez y no duerme", async () => {
    const b = banco();
    expect(
      await esperarAQueSeCalme(() => true, {
        topeMs: 0,
        pasoMs: 150,
        ahora: b.ahora,
        dormir: b.dormir,
      }),
    ).toBe(false);
    expect(b.siestas).toBe(0);
  });
});
