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
  // INVERTIDA el 2026-09-05. Exigía que `lib/projects/module-intent.ts` no
  // exportara ya sus dos funciones; el fichero llevaba desde el 2026-08-29
  // siendo 28 líneas de lápida y un `export {}`, sin un solo importador. Se
  // borró, y con él la última copia de un porqué que ya vivía AQUÍ, en la
  // cabecera de este fichero: estaba contado dos veces, y ésta es la que un
  // `npm test` obliga a mantener honesta.
  it("module-intent.ts ya no existe", () => {
    expect(existsSync(join(raiz, "lib/projects/module-intent.ts"))).toBe(false);
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

// INVERTIDA el 2026-09-05, no borrada — la regla es de esta misma cabecera.
//
// Este bloque era un BRAZO DE CONTROL: exigía que el limpiador de bandas
// siguiera en pie, para que un barrido futuro no confundiera «el puente que
// encendía» con «el limpiador que borra». Hizo su trabajo mientras el
// limpiador tenía trabajo.
//
// Dejó de tenerlo. `buildModuleSection` era el ÚNICO emisor de bandas y llevaba
// CERO llamadas —dos ficheros lo importaban sin usarlo—, así que no queda nada
// capaz de poner una banda nueva: lo único que el limpiador podía encontrarse
// eran bandas HEREDADAS de páginas ya publicadas, y Jesús confirmó que las
// suyas son de prueba. Protegía a un usuario que no existe, escaneando cinco
// marcadores sobre cada documento en cada publicación.
//
// Se invierte para que el hueco quede tapado: si alguien vuelve a traerlo, que
// sea con un emisor delante, no porque este fichero se quedara mudo.
describe("y el limpiador se fue detrás, porque se quedó sin trabajo", () => {
  it.each([
    "lib/publish/strip-disabled-bands.ts",
    "lib/publish/module-sections.ts",
  ])("%s ya no existe", (rel) => {
    expect(existsSync(join(raiz, rel))).toBe(false);
  });

  it("y publicar ya no lo llama", () => {
    const fuente = leer("lib/publish/filesystem.ts");
    expect(fuente).not.toMatch(/stripDisabledModuleBands\(/);
    // ANCLADA A LA LÍNEA DE CÓDIGO, no a la cadena — que es como estaba antes y
    // por el mismo motivo: `collections: false` aparece TAMBIÉN dentro de los
    // comentarios de ese fichero, así que un `not.toMatch(/collections: false/)`
    // fallaría por la lápida en vez de por el código.
    expect(fuente).not.toMatch(/^\s*collections: false,$/m);
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
  // de SOLO LECTURA. Datos vivos era OTRA hoja, en otro sitio de `settings`, y
  // esta prueba sujetaba que siguiera en pie. En Len 2.1 (2026-09-30) se retiró
  // entera —0 de 118 proyectos la usaban— y la prueba pasa a lápida.
  it("y Datos vivos —la otra hoja— tampoco vuelve", () => {
    expect(leer("lib/projects/types.ts")).not.toMatch(/liveData\?: \{ sheetUrl: string \}/);
    expect(existsSync(join(raiz, "lib/live"))).toBe(false);
    expect(existsSync(join(raiz, "app/api/internal/live-republish"))).toBe(false);
  });
});
