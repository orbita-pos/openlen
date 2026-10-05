import { describe, expect, it } from "vitest";

import { resolveCompaction } from "./policy";

describe("la política de compactación (la de DeepSeek)", () => {
  it("con la ventana de hoy (240k) y 32k de salida: umbral 141.696, cola 33.157", () => {
    expect(resolveCompaction({ windowTokens: 240_000, maxOutputTokens: 32_768 })).toEqual({ thresholdTokens: 141_696, retainTokens: 33_157 });
  });

  it("con la ventana real de Fireworks (1.048.576): umbral al 80 %", () => {
    expect(resolveCompaction({ windowTokens: 1_048_576, maxOutputTokens: 32_768 })).toEqual({ thresholdTokens: 838_860, retainTokens: 162_529 });
  });

  it("con 65.536 de salida (Dynamis) también vale", () => {
    expect(resolveCompaction({ windowTokens: 240_000, maxOutputTokens: 65_536 })).toEqual({ thresholdTokens: 108_928, retainTokens: 27_914 });
  });

  it("BRAZO DE CONTROL: una ventana donde no cabe el margen falla al cargar, como en DeepSeek", () => {
    expect(() => resolveCompaction({ windowTokens: 80_000, maxOutputTokens: 32_768 })).toThrow(/compaction policy/);
  });
});
