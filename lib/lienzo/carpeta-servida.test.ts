// @vitest-environment node
// Lo que sirven el lienzo y los ojos de una app (plan 02, tarea 5): la entrada
// ES el paquete de desarrollo, con su sourcemap aparte.
import { afterAll, describe, expect, it } from "vitest";
import { FICHEROS } from "@/lib/apps/shadcn-fixture";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { esFuenteCompilable } from "@/lib/apps/compilador";
import { carpetaDeLaVista, carpetaServida } from "./documento";

afterAll(() => stopBundlerWorker());
const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;

describe("carpetaServida con el paquete (plan 02, tarea 5)", () => {
  it("🔴 la entrada es el paquete (sin imports del catálogo por su nombre) y su mapa va en sourceMaps, no en files", async () => {
    const r = await carpetaServida(FICHEROS, APP);
    expect(r.files["/src/main.jsx"]).not.toMatch(/\bfrom\s*["']react/);
    expect(r.files["/src/main.jsx"]).toContain("Guardar");
    expect(r.sourceMaps["/src/main.jsx"]).toBeTruthy();
    expect(Object.keys(r.files).some((k) => k.endsWith(".map"))).toBe(false);
  }, 60_000);

  it("🔴 una app que no compila: la entrada es un módulo que LANZA los errores del compilador, con su fichero y línea", async () => {
    const r = await carpetaServida({ ...FICHEROS, "/src/lib/utils.ts": "export const x = <;" }, APP);
    expect(r.files["/src/main.jsx"]).toMatch(/^throw new SyntaxError\(/);
    expect(r.files["/src/main.jsx"]).toContain("/src/lib/utils.ts:1");
  }, 60_000);

  it("🔴 la carpeta de una app es la que se publica: la entrada y lo que no es fuente; ni catálogo ni fuentes sueltos", async () => {
    const r = await carpetaServida({ ...FICHEROS, "/tests/a.spec.ts": "x" }, APP);
    const esperadas = Object.keys(FICHEROS).filter((k) => k === APP.entrada || !esFuenteCompilable(k, true));
    expect(Object.keys(r.files).sort()).toEqual(esperadas.sort());
  }, 60_000);

  it("una página (sin app) no cambia: sus ficheros, sin mapas", async () => {
    const r = await carpetaServida({ "/js/app.js": "console.log(1)" }, null);
    expect(r.files["/js/app.js"]).toBe("console.log(1)");
    expect(r.sourceMaps).toEqual({});
  });

  it("carpetaDeLaVista lleva los sourceMaps de una app", async () => {
    const v = await carpetaDeLaVista({ files: FICHEROS, pagina: null, app: APP } as never);
    expect(v?.sourceMaps?.["/src/main.jsx"]).toBeTruthy();
  }, 60_000);
});
