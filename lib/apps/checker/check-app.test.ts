// @vitest-environment node
// El comprobador en su propio hilo (plan 03, tarea 3): lo mismo que el núcleo,
// con tope de tiempo, y un hilo que renace si se cuelga.
import { afterAll, describe, expect, it } from "vitest";
import { checkAppInWorker, stopCheckerWorker } from "./check-app";

afterAll(() => stopCheckerWorker());

describe("el comprobador en su hilo (plan 03, tarea 3)", () => {
  it("da lo mismo que el núcleo, desde un Worker", async () => {
    const r = await checkAppInWorker({
      files: { "/src/A.tsx": "export const n: string = 3;" },
      catalogo: "2026-11",
    });
    expect(r?.typescript.map((d) => d.codigo)).toEqual(["TS2322"]);
  }, 30_000);

  it("🔴 un chequeo que no acaba a tiempo da null, y el siguiente funciona (el hilo renace)", async () => {
    const lento = await checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 3;" }, catalogo: "2026-11" }, 1);
    expect(lento).toBeNull();
    const despues = await checkAppInWorker({ files: { "/src/A.tsx": "export const n = 3;" }, catalogo: "2026-11" });
    expect(despues).toEqual({ typescript: [], eslint: [] });
  }, 30_000);

  it("un catálogo sin types.json no rompe: los imports del catálogo serían any, el resto se comprueba", async () => {
    const r = await checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 3;" }, catalogo: "1999-01" });
    expect(r?.typescript.map((d) => d.codigo)).toEqual(["TS2322"]);
  }, 30_000);

  it("varias peticiones a la vez: cada una recibe lo suyo", async () => {
    const [a, b] = await Promise.all([
      checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 3;" }, catalogo: "2026-11" }),
      checkAppInWorker({ files: { "/src/B.tsx": "export const n: number = 3;" }, catalogo: "2026-11" }),
    ]);
    expect(a?.typescript.map((d) => d.ruta)).toEqual(["/src/A.tsx"]);
    expect(b?.typescript).toEqual([]);
  }, 30_000);
});
