// EL GOLDEN DE LOS CUATRO PROMPTS — la salida ENTERA, carácter a carácter.
//
// POR QUÉ EXISTE. Auditado el 2026-09-01: el repo tenía TRES suites vigilando
// los prompts (`js-clause.test.ts`, `js-clause-superficies.test.ts`,
// `prompts-superficies.test.ts`) y entre las tres sumaban 44 `toContain` /
// `not.toContain` y **CERO snapshots** — no existía ni el directorio
// `__snapshots__`. O sea: se fijaba la PRESENCIA y la AUSENCIA de ciertas
// cláusulas, y los otros ~32.000 caracteres podían derivar en silencio.
//
// Y derivar no es hipotético en este fichero: una frase caducada DENTRO de un
// prompt no es suciedad como un comentario viejo, es una INSTRUCCIÓN, y el
// modelo la obedece. El mismo día de esta auditoría se retiraron dos reglas que
// describían mecanismos borrados —el botón flotante que «repinta el perfil» y
// «la pestaña Brief»—, y las dos llevaban semanas vivas sin que nada chillara.
//
// QUÉ VIGILA, y es lo que las otras tres no pueden: que NADIE cambie estos
// textos sin querer. Un cambio deliberado se acepta con `vitest -u` y entra al
// diff del commit, donde se ve y se revisa. Un cambio accidental —un import que
// arrastra otro bloque, una constante que se mueve, un `swapJsClauses` que
// empieza a casar de más— falla aquí y en ninguna otra parte.
//
// LO QUE SE FIJA ES LO QUE PRODUCCIÓN MANDA, no la constante de al lado. Es la
// lección más cara de este repo («medir la constante NO es medir producción»,
// mordió tres veces): estas cuatro funciones son las que llaman las rutas, con
// el ensamblado completo — contrato mínimo aplicado y cláusulas del JavaScript
// ya intercambiadas.
//
// SÓLO EL MODO POR DEFECTO. `OPENLEN_MIN_CONTRACT=0` restaura el contrato
// completo y es una palanca de salida de emergencia que nadie corre; su
// cobertura ya la da `prompts-superficies.test.ts`, que comprueba las dos ramas.
// Doblar aquí el tamaño del golden por un camino que no se usa sería pagar
// ruido en cada revisión a cambio de nada.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "./agent/catalog";
import { redesignPromptFinal } from "./agent/redesign";
import { PUBLISHED_BASE_HOST } from "./publish/base-host";
import { generateSystemMessage } from "../app/api/generate/system-prompt";
import { aiDesignSystemMessage } from "../app/api/templates/ai-design/system-prompt";

const ENTRADA_REDISENO = {
  html: "<h1>x</h1>",
  direccion: "más moderna",
  brief: null,
};

// EL HOST SE NORMALIZA, y no es cosmética: `PUBLISHED_BASE_HOST` es una const
// de MÓDULO que sale de `NEXT_PUBLIC_PUBLISH_BASE_HOST`, así que se evalúa al
// importar y `vi.stubEnv` no llega a tiempo. Sin esto el golden hornearía el
// `.env.local` de quien lo generó y fallaría en la máquina siguiente por un
// motivo que no tiene nada que ver con el prompt.
function normaliza(prompt: string): string {
  return prompt.replaceAll(PUBLISHED_BASE_HOST, "<PUBLISH_HOST>");
}

const SUPERFICIES: ReadonlyArray<readonly [string, () => string]> = [
  ["crear", () => generateSystemMessage({})],
  ["editar (ai-design)", () => aiDesignSystemMessage()],
  ["agente (Len)", () => buildAgentSystemPrompt()],
  ["rediseño", () => redesignPromptFinal(ENTRADA_REDISENO)],
];

describe("golden de los prompts de producción", () => {
  beforeEach(() => {
    // El entorno se PINCHA en vez de heredarse. `.env.local` inyecta 40
    // variables en este runner, y un golden que dependa de ellas es un golden
    // que sólo vale en un ordenador.
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [nombre, construir] of SUPERFICIES) {
    it(`${nombre} — la salida entera, sin cambios accidentales`, () => {
      expect(normaliza(construir())).toMatchSnapshot();
    });
  }

  // LA CONDICIÓN QUE HACE POSIBLE TODO LO DE ARRIBA, y por eso se comprueba en
  // vez de suponerse: si alguien mete una fecha, un aleatorio o una lectura de
  // reloj dentro de un prompt, el golden empezaría a fallar solo y acabaría
  // desactivado por molesto. Aquí el fallo dice exactamente qué pasó.
  it("los cuatro son deterministas — construirlos dos veces da lo mismo", () => {
    for (const [nombre, construir] of SUPERFICIES) {
      expect(construir(), `«${nombre}» cambia entre dos llamadas seguidas`).toBe(construir());
    }
  });

  // LAS DECLARACIONES DE HERRAMIENTAS TAMBIÉN SON EL PROMPT.
  //
  // Se le mandan al modelo en cada vuelta del bucle y pesan tanto como el
  // texto: medido en la zona 6, el suelo fijo de un turno son ~37.000 tokens
  // de entrada con un documento de UN kilobyte, y buena parte es esto. Lo
  // único que las vigilaba eran unos `toContain` sueltos en `catalog.test.ts`
  // — así se coló durante meses un `resumen: { type: "STRING" }` SIN una línea
  // de descripción, que es lo único que el usuario ve de un cambio en la
  // tarjeta del chat.
  //
  // Se serializan con `JSON.stringify(…, null, 2)`: el orden de las claves es
  // el de inserción del literal, así que es estable, y un diff por líneas se
  // lee. `env: {}` fija el modo por defecto igual que el resto del fichero.
  it("las declaraciones de herramientas, enteras", () => {
    const decls = JSON.stringify(buildFunctionDeclarations({}), null, 2);
    expect(normaliza(decls)).toMatchSnapshot();
  });

  // LA GUARDA DE LA PROPIA NORMALIZACIÓN. `PUBLISHED_BASE_HOST` sale de
  // `NEXT_PUBLIC_PUBLISH_BASE_HOST` y no aparece en NINGÚN prompt de sistema
  // — vive en la descripción de `publicar`, dentro de las declaraciones. Si
  // dejara de aparecer también ahí, `normaliza` se volvería un no-op silencioso
  // y el golden empezaría a hornear el `.env.local` de quien lo regenere.
  it("la normalización del host sigue haciendo falta", () => {
    const decls = JSON.stringify(buildFunctionDeclarations({}));
    expect(decls).toContain(PUBLISHED_BASE_HOST);
    expect(normaliza(decls)).not.toContain(PUBLISHED_BASE_HOST);
  });
});
