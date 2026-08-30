// @vitest-environment node
//
// LÁPIDA del 2026-08-29: el puente IA→módulos se retira.
//
// La prueba que había aquí (`lib/projects/module-intent.test.ts`) EXIGÍA que
// un `data-ol-collection-section` encendiera Colecciones. Sujetaba la mentira:
// mientras pasara, el mecanismo parecía vivo. Se invierte, no se borra — un
// borrado deja el hueco por el que esto vuelve dentro de seis meses.
//
// Por qué se fue: sólo puenteaba `collections`, y las dos mitades que lo
// sostenían ya no existen —`lib/publish/collections-block.ts`, el horneado que
// llenaba el hueco, y la línea del prompt que enseñaba el marcador—. Encendía
// una bandera que nadie leía.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("el puente IA→módulos ya no enciende nada", () => {
  it("module-intent.ts no exporta sus dos funciones", () => {
    const fuente = leer("lib/projects/module-intent.ts");
    expect(fuente).not.toMatch(/export function applyModuleIntent/);
    expect(fuente).not.toMatch(/export function detectModuleIntent/);
  });

  it.each([
    "lib/agent/tools.ts",
    "lib/page-engine/prepare.ts",
    "app/api/templates/ai-design/route.ts",
  ])("%s ya no lo llama", (rel) => {
    expect(leer(rel)).not.toMatch(/applyModuleIntent\(/);
  });

  it("y el informe del motor no lleva ya `modules`", () => {
    // Alimentaba dos ramas —en generate y en ai-design— que escribían
    // `settings` cuando la lista no venía vacía. Sin etapa que la llene, esas
    // ramas eran código muerto que seguía hablando.
    const contrato = leer("lib/page-engine/contract.ts");
    expect(contrato).not.toMatch(/readonly modules:/);
    expect(contrato).not.toMatch(/readonly moduleSettings\?/);
    // OJO: sobre CÓDIGO, no sobre la palabra. `enabledModules` aparece en el
    // comentario-lápida que explica por qué se fue, y una aserción sobre el
    // nombre suelto obligaría a borrar el porqué para ponerse verde. Justo la
    // trampa que ya está anotada en sin-vocabulario-colecciones.test.ts — y
    // aquí me mordió al escribirla.
    expect(leer("app/api/generate/route.ts")).not.toMatch(/const enabledModules/);
    expect(leer("app/api/templates/ai-design/route.ts")).not.toMatch(
      /let enabledModules/,
    );
  });
});

describe("pero el horneado que SÍ limpia sigue en pie", () => {
  // BRAZO DE CONTROL. Si un barrido futuro confundiera «el puente que encendía»
  // con «el limpiador que borra», una banda heredada de Colecciones se quedaría
  // como un hueco con su titular encima en la página ya publicada de alguien.
  // Son cosas opuestas y se parecen en el nombre.
  it("strip-disabled-bands conserva el marcador de los módulos muertos", () => {
    expect(leer("lib/publish/strip-disabled-bands.ts")).toMatch(
      /collections: "data-ol-collection-section"/,
    );
  });

  it("y publicar sigue pasando `collections: false` PERMANENTE", () => {
    // ANCLADA A LA LÍNEA DE CÓDIGO, no a la cadena: `collections: false`
    // aparece TAMBIÉN dentro de un comentario de ese mismo fichero, así que un
    // `toMatch(/collections: false/)` pasa aunque alguien borre el argumento
    // de verdad. Lo comprobé quitándolo: la prueba seguía verde.
    expect(leer("lib/publish/filesystem.ts")).toMatch(/^\s*collections: false,$/m);
  });
});

describe("CollectionsSettings sale del tipo de proyecto", () => {
  it("ni la interfaz ni el campo", () => {
    const tipos = leer("lib/projects/types.ts");
    expect(tipos).not.toMatch(/export interface CollectionsSettings/);
    expect(tipos).not.toMatch(/collections\?: CollectionsSettings/);
  });

  it("y el PATCH de ajustes ya no lo acepta", () => {
    expect(leer("lib/projects/settings-patch.ts")).not.toMatch(/hasCollections/);
  });

  // El módulo muerto tenía una hoja de cálculo propia que dejaba la colección
  // de SOLO LECTURA. DATOS VIVOS ES OTRA COSA, vive en otro sitio de
  // `settings`, y sigue viva: se llamaban parecido, que es justo por lo que
  // esto se comprueba.
  it("pero Datos vivos —que es otra hoja— sigue en pie", () => {
    expect(leer("lib/projects/types.ts")).toMatch(/liveData\?: \{ sheetUrl: string \}/);
    expect(leer("lib/agent/tools.ts")).toMatch(/settings\?\.liveData\?\.sheetUrl/);
    expect(existsSync(join(raiz, "lib/live/republish.ts"))).toBe(true);
  });
});
