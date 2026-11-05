// EL CANVAS, POR PÍXELES (spec local 2026-11-05-ojos-que-ven-el-movimiento, §8.5): cuánto cambió entre
// dos capturas, y si un paso se distingue de lo que el canvas cambia solo. Sin navegador.
import { describe, expect, it } from "vitest";

import type { PngCrudo } from "@/lib/ai/png-crudo";

import { canvasLine, classifyCanvasChange, pixelChange } from "./canvas-change";

const imagen = (ancho: number, alto: number, pinta: (x: number, y: number) => [number, number, number]): PngCrudo => {
  const datos = new Uint8Array(ancho * alto * 3);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pinta(x, y);
      const i = (y * ancho + x) * 3;
      datos[i] = r;
      datos[i + 1] = g;
      datos[i + 2] = b;
    }
  }
  return { ancho, alto, canales: 3, datos };
};

describe("pixelChange", () => {
  it("dos imágenes iguales no cambian", () => {
    const a = imagen(10, 10, () => [10, 20, 30]);
    expect(pixelChange(a, imagen(10, 10, () => [10, 20, 30]))).toBe(0);
  });

  it("la mitad cambiada es 0,5", () => {
    const a = imagen(10, 10, () => [0, 0, 0]);
    const b = imagen(10, 10, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
    expect(pixelChange(a, b)).toBe(0.5);
  });

  it("diferencias de 16 o menos por canal no cuentan (ruido de compresión, suavizado)", () => {
    const a = imagen(10, 10, () => [100, 100, 100]);
    expect(pixelChange(a, imagen(10, 10, () => [116, 84, 100]))).toBe(0);
    expect(pixelChange(a, imagen(10, 10, () => [117, 100, 100]))).toBe(1);
  });

  it("tamaños distintos cuentan como cambio entero", () => {
    expect(pixelChange(imagen(10, 10, () => [0, 0, 0]), imagen(12, 10, () => [0, 0, 0]))).toBe(1);
  });

  it("RGB contra RGBA compara los colores", () => {
    const rgb = imagen(2, 1, () => [5, 6, 7]);
    const rgba: PngCrudo = { ancho: 2, alto: 1, canales: 4, datos: Uint8Array.from([5, 6, 7, 255, 5, 6, 7, 255]) };
    expect(pixelChange(rgb, rgba)).toBe(0);
  });
});

describe("classifyCanvasChange", () => {
  it("casi nada cambió: unchanged", () => {
    expect(classifyCanvasChange({ selfChange: 0, stepChange: 0.001 })).toBe("unchanged");
  });
  it("cambió lo mismo que cambia solo: only_by_itself", () => {
    expect(classifyCanvasChange({ selfChange: 0.1, stepChange: 0.12 })).toBe("only_by_itself");
  });
  it("cambió mucho más de lo que cambia solo: changed", () => {
    expect(classifyCanvasChange({ selfChange: 0.01, stepChange: 0.2 })).toBe("changed");
    expect(classifyCanvasChange({ selfChange: 0, stepChange: 0.05 })).toBe("changed");
  });
});

describe("canvasLine", () => {
  it("dice el hecho con sus cifras, sin veredicto", () => {
    expect(canvasLine("changed", { selfChange: 0, stepChange: 0.123 })).toBe("the canvas changed: 12.3 % of its pixels.");
    expect(canvasLine("changed", { selfChange: 0.02, stepChange: 0.2 })).toBe(
      "the canvas changed: 20 % of its pixels (by itself it changes about 2 % in the same time).",
    );
    expect(canvasLine("only_by_itself", { selfChange: 0.1, stepChange: 0.12 })).toBe(
      "the canvas keeps changing by itself (about 10 %) and this step's effect can't be told apart from that.",
    );
    expect(canvasLine("unchanged", { selfChange: 0, stepChange: 0 })).toBe("the canvas didn't change.");
  });
});
