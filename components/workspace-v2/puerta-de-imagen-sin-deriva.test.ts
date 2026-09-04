// LA PUERTA DE IMAGEN VIVE DOS VECES, y esta prueba es lo único que impide
// que las dos copias se separen.
//
// POR QUÉ HAY DOS. `drop-place-core.ts` es un módulo normal (soltar una foto
// encima, con sus pruebas en jsdom); `use-image-replace.ts` lleva la MISMA
// decisión dentro de un IIFE que se serializa a texto y se inyecta en el
// iframe, así que no puede importar nada. La duplicación es deliberada y está
// explicada en la cabecera de los dos ficheros.
//
// POR QUÉ HACE FALTA VIGILARLA. El 2026-09-04 se arreglaron a la vez, y la
// revisión de ese mismo día señaló que sólo una de las dos tenía pruebas: la
// que NO corre en el editor. Si una deriva, la otra sigue verde y el síntoma
// que ve el usuario —«a veces puedo cambiar la foto y a veces no»— no apunta a
// ningún fichero. Es la avería más cara de diagnosticar que tiene este repo.
//
// QUÉ COMPRUEBA, y qué NO. No compara los fuentes carácter a carácter: uno es
// TypeScript con sus `as HTMLElement` y el otro es ES5 dentro de una cadena, y
// una prueba así fallaría por el ruido y acabaría desactivada. Comprueba que
// las dos ramas de <div> toman las MISMAS decisiones, en el mismo orden.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const leer = (rel: string) => readFileSync(join(raiz, "components/workspace-v2", rel), "utf8");

/** El cuerpo de la rama `DIV` de cada copia, desde su `if` hasta el final. */
function ramaDiv(fuente: string): string {
  const i = fuente.indexOf("=== 'DIV'") >= 0
    ? fuente.indexOf("if (tag === 'DIV'")
    : fuente.indexOf('if (tag === "DIV"');
  expect(i, "no encontré la rama de <div> en esta copia").toBeGreaterThan(-1);
  return fuente.slice(i, i + 1200);
}

// Cada entrada es UNA decisión que las dos copias tienen que tomar. El nombre
// es lo que se lee cuando falla, así que dice la decisión, no el token.
const DECISIONES: ReadonlyArray<readonly [string, RegExp]> = [
  ["el umbral de tamaño es la dimensión MAYOR", /size >= 60/],
  ["se pide el estilo calculado", /getComputedStyle\(el\)/],
  ["hay que estar PINTADA", /backgroundImage === ["']none["']/],
  ["un VELO posicionado queda fuera", /position === ["']absolute["']/],
  ["…y también el fijo", /position === ["']fixed["']/],
  ["…sólo si tiene hermanos", /parentElement\.children\.length > 1/],
  ["`aspect-*` basta para ser destino", /aspect-/],
  ["sin declarar se miden las DOS dimensiones", /Math\.min\(rect\.width, rect\.height\) < 60/],
  ["sin declarar hay que estar VACÍA", /textContent \|\| ["']["']\)\.trim\(\)/],
];

describe("la puerta de imagen no deriva entre sus dos copias", () => {
  const copias = [
    ["drop-place-core.ts (soltar)", ramaDiv(leer("drop-place-core.ts"))],
    ["use-image-replace.ts (sustituir)", ramaDiv(leer("use-image-replace.ts"))],
  ] as const;

  for (const [decision, marca] of DECISIONES) {
    it(`las dos deciden: ${decision}`, () => {
      for (const [nombre, rama] of copias) {
        expect(marca.test(rama), `«${nombre}» ya no decide: ${decision}`).toBe(true);
      }
    });
  }

  // EL ORDEN IMPORTA y no es cosmético: pintar se comprueba ANTES que el texto
  // a propósito, porque `textContent` recorre el subárbol entero y esto corre
  // en cada `mousemove`. Si alguien las intercambia, el editor se vuelve lento
  // de una forma que ninguna prueba de comportamiento nota.
  it("las dos comprueban el fondo ANTES que el texto (esto corre en cada mousemove)", () => {
    for (const [nombre, rama] of copias) {
      const fondo = rama.search(/backgroundImage === ["']none["']/);
      const texto = rama.search(/textContent \|\| ["']["']\)\.trim\(\)/);
      expect(fondo, `«${nombre}»: no encontré la comprobación del fondo`).toBeGreaterThan(-1);
      expect(texto, `«${nombre}»: no encontré la comprobación del texto`).toBeGreaterThan(-1);
      expect(
        fondo < texto,
        `«${nombre}» mira el texto antes que el fondo: recorre el subárbol de cada ancestro en cada mousemove`,
      ).toBe(true);
    }
  });
});
