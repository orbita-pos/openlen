// lib/ai/js-clause.ts — la cláusula sobre JavaScript, en sus dos versiones.
//
// POR QUÉ EXISTE. Con `OPENLEN_MODEL_JS=1` el modelo PUEDE escribir un script y
// ese script SOBREVIVE. Pero el prompt seguía diciéndole lo contrario en tres
// sitios a la vez, y ganaba la prohibición: medido el 2026-08-21, 0 de 6 páginas
// llevaron JavaScript, y en una el modelo escribió
// `<!-- sin javascript: la página es estática y completa -->` justo donde iba el
// script. Con la cláusula cambiada —70 caracteres de diferencia— pasó a 2 de 2.
//
// POR QUÉ SE SUSTITUYE AQUÍ Y NO SE EDITA EL CONTRATO. `PUBLISH_CONTRACT` lo
// comparten las tres superficies (crear, Chat y el Agente) como literal de
// plantilla. Editarlo movería las tres a la vez, sin control, y una superficie
// que no sabe CAPTURAR el script no debe prometerlo. La sustitución en el
// ensamblado deja esa decisión en cada llamador.
//
// 🔴 REGLA QUE NO SE SALTA: sólo se le dice a un modelo que puede escribir
// JavaScript en una superficie que además sepa CAPTURARLO. Prometerlo sin la
// captura es peor que prohibirlo — el sanitizador lo borra y la página nace con
// botones muertos, que es exactamente lo que el contrato viejo evitaba.

import { modelJsEnabled } from "@/lib/ai-stream/model-runtime";

export type ClauseId =
  /** La viñeta de `PUBLISH_CONTRACT_MIN`. */
  | "contrato-min"
  /** El bloque `• NO JAVASCRIPT` de `PUBLISH_CONTRACT`. */
  | "contrato-completo"
  /** La línea de NON-NEGOTIABLE CONSTRAINTS (crear y Chat la comparten). */
  | "no-negociable"
  /** La regla del Agente en `lib/agent/catalog.ts`. */
  | "agente"
  /** La regla nº5 del rediseño en `lib/agent/redesign.ts`. */
  | "rediseno";

interface Clausula {
  /** Marca inicial, exacta. Si no aparece, la sustitución LANZA. */
  readonly desde: string;
  /** Marca final EXCLUSIVA: se conserva. `"\n"` = hasta el fin de la línea. */
  readonly hasta: string;
  /** Lo que se pone en su lugar cuando el JavaScript del modelo está abierto. */
  readonly libre: string;
}

// La frase sobre ocultar contenido NO es retórica: en la corrida de la Fase 0 el
// modelo definió `.reveal { opacity: 0 }` y sólo se salvó de entregar una página
// en blanco porque olvidó ponerle la clase a algún elemento. Si el script se
// descarta —y hay diez motivos por los que puede descartarse— una página que
// esconde su contenido en CSS llega vacía.
const SIN_OCULTAR_ES =
  "Nunca escondas contenido con CSS para revelarlo desde el script: si el script se descarta, la página llega en blanco.";
const SIN_OCULTAR_EN =
  "Never hide content in CSS and reveal it from the script: if the script is dropped, the page ships blank.";

// MEDIDO en la corrida del 21/08: de 6 páginas con JavaScript, la del carrito
// cableó sus botones con `onclick="addToCart(1)"` y NINGÚN `addEventListener`.
// El script sobrevivió entero —hash en la CSP incluido— y el carrito quedó mudo:
// «agregar» no hacía nada. Las otras cinco usaron `addEventListener` y funcionan.
//
// El dato ya estaba en el prompt, pero enterrado en la lista de QUÉ MÁS SE BORRA,
// que se lee como una consecuencia para otros scripts. Aquí va como INSTRUCCIÓN.
//
// No hay reparación posible aguas abajo: conservar el `onclick` exigiría
// `'unsafe-hashes'` en la CSP, y un shim que evaluara la expresión exigiría
// `'unsafe-eval'` — las dos debilitan la política de TODAS las páginas para
// salvar el cableado de una. El prompt es la única palanca legítima.
const CABLEADO_ES =
  "Cablea los manejadores con `addEventListener` DENTRO del script: los atributos `onclick=` —y cualquier `on*`— se borran al guardar, así que un botón cableado así queda mudo aunque el script sobreviva entero.";
const CABLEADO_EN =
  "Wire handlers with `addEventListener` INSIDE the script: `onclick=` — and any `on*` — attributes are stripped on save, so a button wired that way is dead even though the script itself survives.";

const CLAUSULAS: Readonly<Record<ClauseId, Clausula>> = {
  "contrato-min": {
    desde: "• NINGÚN JavaScript sobrevive.",
    hasta: "\n",
    libre:
      "• JavaScript: UN solo `<script data-openlen-model-runtime>`, el último del `<body>`, SOBREVIVE a la publicación — escríbelo cuando la página gane algo de verdad con él: filtrar una lista, una galería con lightbox, pestañas, una cuenta atrás, buscar dentro de la propia página. " +
      "Todo lo demás se sigue borrando: cualquier otro `<script>` salvo el de Tailwind, todo atributo `on*` y todo `<iframe>`. " +
      `${CABLEADO_ES} ` +
      `La página tiene que estar completa y legible SIN ese script: mejora, nunca construye el contenido. ${SIN_OCULTAR_ES} ` +
      "Cuando el CSS puro ya resuelve —`<details>`/`<summary>`, un checkbox con `peer-checked:`, `:target`, `@keyframes`— prefiérelo; para lo demás, escribe el script.",
  },

  "contrato-completo": {
    desde: "• NO JAVASCRIPT — it does not survive.",
    hasta: "• NO `<iframe>` — stripped as well.",
    libre:
      "• JAVASCRIPT — exactly ONE `<script data-openlen-model-runtime>`, the last\n" +
      "  element in `<body>`, SURVIVES publication. Write it when the page genuinely\n" +
      "  gains something: filtering a list, a lightbox, tabs, a countdown, in-page\n" +
      "  search. Everything else is still STRIPPED before the page is saved: any\n" +
      "  other `<script>` (the Tailwind CDN tag being the one exception), every\n" +
      "  `on*` attribute, and every `<iframe>`.\n" +
      `  ${CABLEADO_EN}\n` +
      "  The page MUST be complete and readable WITHOUT that script — it improves,\n" +
      `  it never builds the content. ${SIN_OCULTAR_EN}\n` +
      "  When plain CSS already does the job, prefer it:\n" +
      "         – accordion / FAQ      → `<details><summary>`\n" +
      "         – mobile nav, toggles  → hidden checkbox + `peer-checked:` (or `:target`)\n" +
      "         – tabs                 → radio inputs + `peer-checked:`\n" +
      "         – entrances, hovers, marquees → `@keyframes` / `transition`\n" +
      "  A `<button>` still does NOTHING unless it submits a form, carries a\n" +
      "  behavior marker, or your script wires it up. Never ship a dead control.\n",
  },

  "no-negociable": {
    desde: "- NO React, NO Babel, NO JSX,",
    hasta: "\n",
    libre:
      '- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO import statements. Your own JavaScript goes in the single block described below.',
  },

  agente: {
    desde: "- OpenLen NO ejecuta JavaScript de la página:",
    hasta: "\n",
    libre:
      "- Puedes escribir el JavaScript de la página: UN solo `<script data-openlen-model-runtime>`, el último del body, sobrevive al guardar. " +
      "Todo lo demás se sigue borrando: cualquier otro `<script>`, todo atributo `on*` y todo `<iframe>`. " +
      `${CABLEADO_ES} ` +
      `La página tiene que funcionar SIN él. ${SIN_OCULTAR_ES} ` +
      "Cuando el CSS puro alcanza (`<details>`/`<summary>`, checkbox + `peer-checked:`, `:target`, `scroll-snap`), prefiérelo. " +
      "Y si lo que piden es una feature de backend de verdad (login, agenda, catálogo administrable), eso NO se resuelve con un script: usa activar_modulo.",
  },

  rediseno: {
    desde: "5. NADA de JavaScript propio:",
    hasta: "\n",
    libre:
      "5. Puedes escribir JavaScript: UN solo `<script data-openlen-model-runtime>`, el último del body. " +
      "Cualquier OTRO `<script>`, los atributos `on*` y los `<iframe>` se siguen borrando al guardar. " +
      `${CABLEADO_ES} ` +
      `La página tiene que funcionar sin él. ${SIN_OCULTAR_ES}`,
  },
};

/**
 * Cambia las cláusulas indicadas por su versión permisiva.
 *
 * Con el interruptor apagado devuelve el prompt TAL CUAL: ninguna generación
 * normal cambia ni un carácter.
 *
 * 🔴 LANZA si una marca no aparece, y ésa es toda la gracia. `String.replace`
 * con un literal que se desplazó es un no-op SILENCIOSO: devolvería el prompt
 * prohibitivo, el modelo no escribiría nada, y el síntoma sería "el JavaScript
 * del modelo no funciona" en vez de "la marca cambió". Ya nos costó una corrida
 * entera medir un brazo que no existía.
 */
export function swapJsClauses(
  prompt: string,
  ids: readonly ClauseId[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (!modelJsEnabled(env)) return prompt;
  let out = prompt;
  for (const id of ids) {
    const c = CLAUSULAS[id];
    const i = out.indexOf(c.desde);
    if (i === -1) {
      throw new Error(
        `swapJsClauses: la cláusula "${id}" no apareció en el prompt — su marca inicial ` +
          `cambió de redacción. Actualiza lib/ai/js-clause.ts; NO la ignores: sin esto el ` +
          `prompt sigue prohibiendo el JavaScript que el resto del sistema sí acepta.`,
      );
    }
    const j =
      c.hasta === "\n"
        ? (out.indexOf("\n", i) === -1 ? out.length : out.indexOf("\n", i))
        : out.indexOf(c.hasta, i);
    if (j === -1) {
      throw new Error(`swapJsClauses: la cláusula "${id}" no tiene fin — falta la marca "${c.hasta}".`);
    }
    out = out.slice(0, i) + c.libre + out.slice(j);
  }
  return out;
}

/** Sólo para las pruebas: el texto prohibitivo que cada cláusula sustituye. */
export function clauseMarker(id: ClauseId): string {
  return CLAUSULAS[id].desde;
}
