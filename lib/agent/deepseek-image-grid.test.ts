// LA REJILLA DE DEEPSEEK V4.1 (el modelo de Len): a qué tamaño llega una imagen para que el modelo la vea
// entera. Los números son los de la nota de DeepSeek
// (.agents/notes/archived/bug-fix/2026-09-10-deepseek-v41-request-image-projection.md, deepseek-harness).
import { describe, expect, it } from "vitest";

import { deepSeekImageTokens, deepSeekRequestImageDimensions } from "./deepseek-image-grid";

describe("deepSeekRequestImageDimensions", () => {
  it("una imagen que cabe en la rejilla va tal cual (la pestaña de los ojos, 1280×900)", () => {
    expect(deepSeekRequestImageDimensions(1280, 900)).toEqual({ width: 1280, height: 900 });
  });

  it("un 3840×2160 se manda a 1708×961, como dice la nota de DeepSeek", () => {
    expect(deepSeekRequestImageDimensions(3840, 2160)).toEqual({ width: 1708, height: 961 });
  });

  it("un cuadrado se queda en 1302×1302", () => {
    expect(deepSeekRequestImageDimensions(2000, 2000)).toEqual({ width: 1302, height: 1302 });
  });

  it("un 1224×1429 se manda a 1187×1386, como dice la nota de DeepSeek", () => {
    expect(deepSeekRequestImageDimensions(1224, 1429)).toEqual({ width: 1187, height: 1386 });
  });

  it("una imagen pequeña nunca se agranda", () => {
    expect(deepSeekRequestImageDimensions(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("deepSeekImageTokens", () => {
  it("lo que cobra el proveedor: 994 tokens por el cuadrado entero, nunca más de 1024", () => {
    expect(deepSeekImageTokens(1302, 1302)).toBe(994);
    expect(deepSeekImageTokens(4000, 4000)).toBeLessThanOrEqual(1024);
  });
});
