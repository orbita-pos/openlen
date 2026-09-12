// @vitest-environment node
//
// Entorno `node` a proposito: importar `vitest.config.ts` arrastra esbuild, y
// bajo jsdom su comprobacion de `new TextEncoder().encode("") instanceof
// Uint8Array` sale falsa y el fichero ni carga.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "tinyglobby";
import config from "../vitest.config";

/**
 * TODO `.test.ts` DEL REPO LO CORRE ALGUIEN, O ESTA AQUI DECLARADO.
 *
 * POR QUE EXISTE. Este repo tiene DOS runners —vitest y `npm run test:node`— y
 * el `include` de vitest es una lista blanca con globs. Un fichero de prueba que
 * no case con ninguno de los dos existe, compila, y NO CORRE NUNCA: `npm test`
 * sale verde igual. Es el fallo mas silencioso que hay, porque la ausencia de
 * senal se lee como senal buena.
 *
 * MEDIDO el 2026-09-12: `lib/generation/fable-parity-review-session.test.ts`
 * llevaba 20 pruebas sin correr. Estaba en el `exclude` de vitest bajo el
 * comentario «node:test file (run via tsx --test, part of test:node)» — y era
 * falso por partida doble: importa de `"vitest"`, y no estaba en la lista de
 * `test:node`. Se habia colado en la misma linea que un fichero que si lo era.
 *
 * 🔴 Y LA LECCION DE METODO, que es la mitad del valor de esta guarda: para
 * averiguarlo hicieron falta CUATRO mediciones, y las tres primeras fueron
 * basura por leer `vitest.config.ts` con expresiones regulares — un parser
 * casero se traga los globs, los comentarios y las rutas con corchetes como
 * `app/api/.../[id]/route.test.ts`. La cuarta acerto porque le pregunto AL
 * RUNNER (`npx vitest list --filesOnly`). Esta guarda no vuelve a parsear a
 * mano: importa la config de verdad y resuelve sus globs con el MISMO motor que
 * usa vitest (tinyglobby).
 */

const CFG = (config as { test?: { include?: string[]; exclude?: string[] } }).test ?? {};

/** Lo que corre el OTRO runner, leido de su propia linea en package.json. */
function deTestNode(): string[] {
  const pj = readFileSync("package.json", "utf8");
  const linea = /"test:node":\s*"([^"]+)"/.exec(pj)?.[1] ?? "";
  return linea.match(/[^\s"]+\.test\.tsx?/g) ?? [];
}

/** Fuera del alcance de los dos runners, y a proposito. Cada entrada con su por
 *  que: una exclusion sin motivo escrito es como nacio el fichero oscuro. */
const DECLARADOS_FUERA: ReadonlyArray<readonly [string, string]> = [
  ["scratch/", "sondas desechables, gitignorado entero (.gitignore:185)"],
  [
    "lib/publish/font-bake.live.test.ts",
    "smoke LIVE contra fonts.googleapis.com; su cabecera documenta OPENLEN_LIVE_TESTS=1",
  ],
  ["tests/e2e/", "Playwright, runner propio"],
  ["infra/", "subproyecto con su propio package.json"],
];

describe("ningun fichero de prueba se queda a oscuras", () => {
  it("todo .test.ts lo corre vitest, test:node, o esta declarado fuera", () => {
    const enDisco = globSync(["**/*.test.ts", "**/*.test.tsx"], {
      // `**/` delante: `node_modules/**` a secas solo casa en la RAIZ, y este
      // repo tiene un subproyecto con los suyos (`sites/len/node_modules/`)
      // cuyas dependencias traen sus propios .test.ts.
      ignore: [
        "**/node_modules/**",
        "**/.next/**",
        "**/dist/**",
        "**/coverage/**",
        "**/.superpowers/**",
      ],
    }).map((f) => f.split("\\").join("/"));

    // Los MISMOS globs de la config, con el MISMO motor. Nada de regex.
    const vitest = new Set(
      globSync(CFG.include ?? [], { ignore: CFG.exclude ?? [] }).map((f) => f.split("\\").join("/")),
    );
    const node = new Set(deTestNode());

    const oscuros = enDisco.filter(
      (f) =>
        !vitest.has(f) &&
        !node.has(f) &&
        !DECLARADOS_FUERA.some(([p]) => (p.endsWith("/") ? f.startsWith(p) : f === p)),
    );

    expect(
      oscuros,
      `Estos ficheros de prueba no los corre NADIE y no estan declarados fuera. `
        + `Anadelos al include de vitest.config.ts, a la linea test:node de `
        + `package.json, o a DECLARADOS_FUERA con su motivo. `
        + `(en disco ${enDisco.length}, vitest ${vitest.size}, test:node ${node.size})`,
    ).toEqual([]);

    // BRAZO DE CONTROL DEL BARRIDO: sin esto, un glob roto daria «limpio» por
    // haber mirado cero ficheros — que es justo como se colo el oscuro.
    expect(enDisco.length).toBeGreaterThan(350);
    expect(vitest.size).toBeGreaterThan(300);
    expect(node.size).toBeGreaterThan(30);
  });
});
