// @vitest-environment node
// El comprobador en su propio hilo (plan 03, tarea 3): lo mismo que el núcleo,
// con tope de tiempo, y un hilo que renace si se cuelga.
import { afterAll, describe, expect, it } from "vitest";
import { checkAppInWorker, stopCheckerWorker } from "./check-app";
import { FICHEROS } from "../shadcn-fixture";

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

  it("🔴 una petición nueva de la MISMA sesión sustituye a la que espera en la cola (como `geterr` de tsserver); la de otra sesión, no", async () => {
    const sesion = {};
    const otra = {};
    const enCurso = checkAppInWorker({ files: { "/src/A.tsx": "export const a = 1;" }, catalogo: "2026-11" });
    const vieja = checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 1;" }, catalogo: "2026-11", supersedes: sesion });
    const deOtra = checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 2;" }, catalogo: "2026-11", supersedes: otra });
    const nueva = checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 3;" }, catalogo: "2026-11", supersedes: sesion });
    expect(await vieja).toBeNull();
    expect((await nueva)?.typescript.map((d) => d.codigo)).toEqual(["TS2322"]);
    expect((await deOtra)?.typescript.map((d) => d.codigo)).toEqual(["TS2322"]);
    expect(await enCurso).toEqual({ typescript: [], eslint: [] });
  }, 30_000);

  it("🔴 el tope cuenta desde que la petición ENTRA al hilo, no desde que se encola: una cola larga no caduca ni mata el hilo", async () => {
    // En caliente CON la misma app: cada chequeo de la cola es el de una app ya
    // vista (~0,5 s; algo más con la máquina cargada), muy por debajo del tope;
    // la cola entera (30), muy por encima.
    await checkAppInWorker({ files: { ...FICHEROS, "/src/X.ts": "export const x = -1;" }, catalogo: "2026-11" });
    const muchas = Array.from({ length: 30 }, (_, i) =>
      checkAppInWorker({ files: { ...FICHEROS, "/src/X.ts": `export const x = ${i};` }, catalogo: "2026-11" }, 8_000),
    );
    const r = await Promise.all(muchas);
    expect(r.filter((x) => x === null)).toHaveLength(0);
  }, 120_000);

  it("varias peticiones a la vez: cada una recibe lo suyo", async () => {
    const [a, b] = await Promise.all([
      checkAppInWorker({ files: { "/src/A.tsx": "export const n: string = 3;" }, catalogo: "2026-11" }),
      checkAppInWorker({ files: { "/src/B.tsx": "export const n: number = 3;" }, catalogo: "2026-11" }),
    ]);
    expect(a?.typescript.map((d) => d.ruta)).toEqual(["/src/A.tsx"]);
    expect(b?.typescript).toEqual([]);
  }, 30_000);
});
