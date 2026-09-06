// NINGUNA OPERACIÓN DE LA POLÍTICA SIN QUIEN LA PIDA.
//
// El 2026-09-06 la tabla de `model-policy.ts` tenía CUATRO operaciones con cero
// llamadores: `creative_direction`, `page_planning`, `initial_section_program` y
// `visual_repair`. Las cuatro eran restos de tuberías borradas hace semanas, y
// dos de ellas sostenían un papel entero —`designer`, GLM 5p2— que por tanto
// tampoco corría nunca.
//
// 🔴 POR QUÉ ESTO MERECE UNA GUARDA Y NO UN COMENTARIO. Una fila aquí no es
// documentación: es una decisión de gasto con un nombre de modelo al lado.
// Mientras esté escrita se lee como una alternativa que existe — y CLAUDE.md
// dice literalmente «lee la tabla, nunca un nombre de modelo escrito en otro
// sitio», así que una sesión que la lea razonará desde ella. Es la misma familia
// que [[la-palanca-que-no-vuelve-a-ningun-sitio]]: lo que no vuelve a ningún
// sitio se retira, y se deja la prueba INVERTIDA vigilando la puerta cerrada.
//
// Cómo: se leen los nombres de la propia tabla del fuente (no de un duplicado) y
// se busca cada uno por el repo. Un nombre que sólo aparece en la política y en
// sus pruebas no lo pide nadie.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reasoningEffortAllowed } from "./model-policy";

const RAIZ = process.cwd();
const CARPETAS = ["lib", "app", "scripts", "tools", "components"];
/** Los ficheros de la propia política y sus pruebas no cuentan como llamadores:
 *  una tabla que se nombra a sí misma justificaría cualquier fila. */
const NO_CUENTAN = ["model-policy.ts", "model-policy.test.ts", "model-policy-sin-huerfanas.test.ts"];

function ficherosTs(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === ".next") continue;
    const ruta = join(dir, entrada);
    const st = statSync(ruta);
    if (st.isDirectory()) ficherosTs(ruta, salida);
    else if (/\.tsx?$/.test(entrada) && !NO_CUENTAN.includes(entrada)) salida.push(ruta);
  }
  return salida;
}

/** Las operaciones, leídas del fuente. Un duplicado escrito a mano aquí sería
 *  otra copia que se puede quedar atrás — que es el fallo que esto vigila. */
function operacionesDeclaradas(): string[] {
  const fuente = readFileSync(join(RAIZ, "lib", "generation", "model-policy.ts"), "utf8");
  const bloque = fuente.slice(
    fuente.indexOf("export type ModelOperation ="),
    fuente.indexOf("const OPERATION_POLICY"),
  );
  return [...bloque.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("la política de modelos no cría filas muertas", () => {
  const operaciones = operacionesDeclaradas();
  const ficheros = CARPETAS.flatMap((c) => ficherosTs(join(RAIZ, c)));
  const corpus = ficheros.map((f) => readFileSync(f, "utf8")).join("\n");

  it("el montaje lee de verdad la tabla y el repo", () => {
    // Sin esto, un recorrido roto dejaría la guarda en verde por no encontrar
    // nada — el mismo fallo que ya mordió en `fuente-sin-bytes-de-control`.
    expect(operaciones.length).toBeGreaterThan(5);
    expect(ficheros.length).toBeGreaterThan(500);
  });

  it.each(operacionesDeclaradas())("alguien pide «%s»", (operacion) => {
    expect(
      corpus.includes(`"${operacion}"`) || corpus.includes(`'${operacion}'`),
      `«${operacion}» está en la política y no la nombra nadie. Si su tubería murió, ` +
        `retírala de la tabla: una operación sin llamador se lee como una alternativa que existe.`,
    ).toBe(true);
  });

  it("🔴 ningún papel admite ya el esfuerzo «max» — la puerta quedó cerrada", () => {
    // `max` sigue en `FireworksReasoningEffort` porque ese tipo describe lo que
    // el CABLE acepta, no lo que nosotros pedimos. Lo que se retiró es el único
    // papel que lo admitía. Esto es la prueba invertida: no se borra el
    // vocabulario del proveedor, se deja escrito que no hay puerta.
    for (const papel of ["reasoner", "visual_critic", "agent"] as const) {
      expect(reasoningEffortAllowed(papel, "max"), `${papel} admite max`).toBe(false);
    }
  });
});
