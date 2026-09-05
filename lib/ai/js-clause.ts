// lib/ai/js-clause.ts — la cláusula sobre JavaScript, en sus dos versiones.
//
// POR QUÉ EXISTE. El modelo PUEDE escribir un script y ese script SOBREVIVE
// —sin condición: el interruptor `OPENLEN_MODEL_JS` que esta línea nombraba se
// borró el 2026-08-26 y ningún `.ts` lo lee, así que citarlo hacía parecer que
// hay un modo apagado en el que esto no aplica. No lo hay. Pero el prompt
// seguía diciéndole lo contrario en tres
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



export type ClauseId =
  /** La viñeta de `PUBLISH_CONTRACT_MIN`. */
  | "contrato-min"
  /** El bloque `• NO JAVASCRIPT` de `PUBLISH_CONTRACT`. */
  | "contrato-completo"
  /**
   * El CONTRATO DEL CARRUSEL + el manual entero de las 9 CONDUCTAS
   * (`buildBehaviorsDoc()`), que son adyacentes: 10.752 caracteres.
   *
   * Las conductas existían SÓLO porque el JavaScript estaba cerrado. Con el
   * interruptor encendido el modelo escribe la interactividad él mismo, que es
   * como la escribe cualquier desarrollador — y como la escriben v0 y Claude.
   *
   * 🔴 Por qué hacía falta ESTA cláusula además de `contrato-completo`: aquélla
   * ya se llevaba la ORDEN («2. A CONDUCTA, for the 9 things…»), pero dejaba el
   * MANUAL DE REFERENCIA delante del modelo. Medido el 2026-08-23: con el JS
   * libre encendido el modelo siguió emitiendo `data-ol-sticky` —y olvidó la
   * regla CSS de `[data-ol-stuck]`, así que el nav nacía mudo. Quitar la orden
   * y dejar el manual es no quitar nada.
   */
  | "conductas"
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
// El script sobrevivió entero y el carrito quedó mudo: «agregar» no hacía nada.
// Las otras cinco usaron `addEventListener` y funcionan.
//
// El dato ya estaba en el prompt, pero enterrado en la lista de QUÉ MÁS SE BORRA,
// que se lee como una consecuencia para otros scripts. Aquí va como INSTRUCCIÓN.
//
// 🔴 POR QUÉ SE BORRAN LOS `on*`, corregido el 2026-09-01. Aquí ponía que
// conservarlos «exigiría `'unsafe-hashes'` en la CSP» y que un shim que evaluara
// la expresión «exigiría `'unsafe-eval'`», así que el prompt era «la única
// palanca legítima». Esa razón CADUCÓ: la CSP se retiró el 2026-08-26 (ver la
// cabecera de `crates/html-engine/src/publish/seal.rs`). No queda política que
// debilitar, y el argumento sobrevivió a lo que describía.
//
// La razón viva es otra y basta por sí sola: los `on*` los quita el SANEADO
// XSS, junto a los `javascript:` y los `<iframe>` fuera de lista (ver la
// cabecera de `crates/html-engine/src/sanitize/mod.rs`). La conclusión no
// cambia —cablea con `addEventListener` o el botón nace mudo—, cambia el porqué.
//
// Y con la CSP fuera, «no hay reparación posible aguas abajo» ya no es cierto
// sin más: restaurar o reescribir un `on*` en la ingestión es discutible, no
// imposible. Está abierto para las plantillas curadas —donde el HTML es
// NUESTRO— y sin decidir. Lo que NO cambia es esto: mientras el saneador se los
// lleve, prometerle al modelo que su `onclick` sobrevive sería mentirle.
const CABLEADO_ES =
  "Cablea los manejadores con `addEventListener` DENTRO del script: los atributos `onclick=` —y cualquier `on*`— se borran al guardar, así que un botón cableado así queda mudo aunque el script sobreviva entero.";

// EL SEGUNDO PUNTO CIEGO MEDIDO del JavaScript del modelo, y el que no lanza:
// una clase que el script pone y que nadie define en el CSS deja el control
// MUDO — se ejecuta, no falla, no sale en consola, y no se nota. (El primero,
// que los `on*` se borran, lo cubre `CABLEADO_ES`.)
//
// Vivía suelta en `contrato-min`. Se extrae aquí porque desde el 2026-09-04 el
// Agente RETIRA esa viñeta del contrato —sus REGLAS DURAS ya decían todo lo
// demás— y ésta era lo ÚNICO que el contrato aportaba y su regla no. Una frase
// medida no puede perderse al quitar una duplicación.
const DOS_MITADES_ES =
  "Escribe SIEMPRE LAS DOS MITADES: el comportamiento y el CSS del estado que ese comportamiento activa — una clase que el script pone y que nadie define en el CSS deja el control mudo, se ejecuta y no se nota.";
const CABLEADO_EN =
  "Wire handlers with `addEventListener` INSIDE the script: `onclick=` — and any `on*` — attributes are stripped on save, so a button wired that way is dead even though the script itself survives.";

const CLAUSULAS: Readonly<Record<ClauseId, Clausula>> = {
  "contrato-min": {
    desde: "• NINGÚN JavaScript sobrevive.",
    hasta: "\n",
    libre:
      "• JavaScript: tu código SOBREVIVE a la publicación — escríbelo cuando la página gane algo de verdad con él: filtrar una lista, una galería con lightbox, pestañas, una cuenta atrás, buscar dentro de la propia página. Ponlo TODO en UN `<script>`, el último del `<body>`: no es un límite del sistema, es para que se pueda editar después de una pieza. " +
      "" +
      `${CABLEADO_ES} ` +
      // 🔴 LAS DOS MITADES, también aquí (2026-09-01). Esta frase vivía SÓLO en
      // la cláusula `conductas`, que sustituye un bloque que el contrato mínimo
      // ya no tiene — así que la ruta del mínimo se quedaba sin ella. Y no es
      // retórica: es el segundo de los dos puntos ciegos medidos del JavaScript
      // del modelo. Una clase que el script pone y que nadie define en el CSS
      // deja el control MUDO — se ejecuta, no lanza, no sale en consola, y no
      // se nota. El primero (`on*` se borra) ya lo cubre `CABLEADO_ES`.
      `${DOS_MITADES_ES} ` +
      `La página tiene que estar completa y legible SIN ese script: mejora, nunca construye el contenido. ${SIN_OCULTAR_ES} ` +
      "Cuando el CSS puro ya resuelve —`<details>`/`<summary>`, un checkbox con `peer-checked:`, `:target`, `@keyframes`— prefiérelo; para lo demás, escribe el script.",
  },

  "contrato-completo": {
    desde: "• NO JAVASCRIPT — it does not survive.",
    // ⚠️ La marca final se movió el 2026-08-31, del `• NO <iframe>` al `• CAROUSEL`
    // que abre la cláusula `conductas`. Motivo: entre las dos había un bloque de
    // cuatro líneas que NINGUNA cláusula tocaba, y que decía «NO <iframe> …
    // No embedded map, no Spotify, no Calendly» más una promesa de horneado
    // (`a plain <a href> … is turned into an in-page player automatically`)
    // borrada el 2026-08-26. Se lo tragaba entero el hueco entre dos cláusulas.
    // `hasta` es EXCLUSIVA, así que `• CAROUSEL` sobrevive y `conductas` sigue
    // encontrando su marca cuando corre después.
    hasta: "• CAROUSEL — a horizontal rail WITH working arrows",
    libre:
      "• JAVASCRIPT — your code SURVIVES publication. Write it when the page\n" +
      "  genuinely gains something: filtering a list, a lightbox, tabs, a countdown,\n" +
      "  in-page search. Put it ALL in ONE `<script>`, the last element in `<body>` —\n" +
      "  not a system limit, but so the behaviour can be edited later in one piece.\n" +
      `  ${CABLEADO_EN}\n` +
      "  The page MUST be complete and readable WITHOUT that script — it improves,\n" +
      `  it never builds the content. ${SIN_OCULTAR_EN}\n` +
      "  When plain CSS already does the job, prefer it:\n" +
      "         – accordion / FAQ      → `<details><summary>`\n" +
      "         – mobile nav, toggles  → hidden checkbox + `peer-checked:` (or `:target`)\n" +
      "         – tabs                 → radio inputs + `peer-checked:`\n" +
      "         – entrances, hovers, marquees → `@keyframes` / `transition`\n" +
      "  A `<button>` still does NOTHING unless it submits a form or your script\n" +
      "  wires it up. Never ship a dead control.\n" +
      "• `<iframe>` — ONLY from a short allowlist: Google Maps, YouTube and Vimeo.\n" +
      "  Anything else is stripped on save. Write them directly — there is NO\n" +
      "  publish-time transform that turns a link into an embed.\n" +
      '         – map   → `<iframe src="https://maps.google.com/maps?q=<address>&output=embed" loading="lazy">` — no key, no account.\n' +
      '         – video → `<iframe src="https://www.youtube.com/embed/<ID>">` or `https://player.vimeo.com/video/<ID>`, and ONLY when the brief gives you the link: an invented ID is a broken player.\n' +
      "  For anything else (Spotify, Calendly, third-party booking) do not fake an\n" +
      "  embed — link out with an honest `<a href>`.\n",
  },

  conductas: {
    desde: "• CAROUSEL — a horizontal rail WITH working arrows",
    hasta: "• NO `data-slot-path=` attribute anywhere",
    libre:
      "• INTERACTIVIDAD — la escribes TÚ, con CSS y con tu `<script>`. No hay\n" +
      "  marcadores declarativos que aprender ni contratos de OpenLen que seguir.\n" +
      "  Si la página gana algo con un contador en vivo, un filtro, un lightbox,\n" +
      "  copiar al portapapeles, pestañas, un tema claro/oscuro o una barra que se\n" +
      "  vuelve sólida al bajar, constrúyelo como lo construirías en cualquier otro\n" +
      "  sitio web.\n" +
      "  Prefiere CSS cuando ya basta — `position: sticky`, `<details>`,\n" +
      "  `scroll-snap`, `@keyframes`, `peer-checked:` — y deja el JavaScript para el\n" +
      "  estado que el CSS no puede llevar solo. Un carrusel es un contenedor\n" +
      "  `overflow-x:auto snap-x` con dos botones que llaman a `scrollBy`; no\n" +
      "  necesita ningún contrato especial.\n" +
      "  Escribe SIEMPRE LAS DOS MITADES: el comportamiento y el CSS del estado que\n" +
      "  ese comportamiento activa. Una clase que el script pone y que nadie define\n" +
      "  en el CSS deja el control mudo — se ejecuta y no se nota.\n",
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
      "- Puedes escribir el JavaScript de la página, y sobrevive al guardar. Ponlo TODO en UN `<script>`, el último del body: no es un límite del sistema, es para poder cambiarlo después de una pieza con target=\"runtime\". " +
      "Los atributos `on*` sí se borran. " +
      `${CABLEADO_ES} ` +
      `${DOS_MITADES_ES} ` +
      `La página tiene que funcionar SIN él. ${SIN_OCULTAR_ES} ` +
      "Cuando el CSS puro alcanza (`<details>`/`<summary>`, checkbox + `peer-checked:`, `:target`, `scroll-snap`), prefiérelo. " +
      // ⚰️ AQUÍ ESTABA LA LISTA DE `<iframe>` PERMITIDOS, retirada el 2026-09-04.
      // No se pierde: el contrato la trae más completa —las formas de URL de
      // YouTube y de Vimeo, «sólo si el brief te da el enlace», y qué hacer con
      // Spotify o Calendly—, y el Agente conserva ese bloque. Aquí sólo estaba
      // la mitad corta, dicha por segunda vez.
      "COBRAR SÍ SE PUEDE, y sin servidor: si el dueño te da su enlace de pago de Stripe, cablea el botón con `<a href=\"https://buy.stripe.com/…\">`. NUNCA te inventes esa dirección — si no la tiene, explícale que la crea en su panel de Stripe y déjale el botón apuntando a donde te diga. " +
      "GUARDAR TAMBIÉN: declara un almacén en la página (el bloque data-ol-stores) y tu JavaScript escribe y lee con fetch a /api/d/<sub>/<almacén> — un carrito que sobrevive a recargas, un menú que mantiene el dueño, reseñas que dejan los visitantes.",
  },

  rediseno: {
    desde: "5. NADA de JavaScript propio:",
    hasta: "\n",
    libre:
      "5. Puedes escribir JavaScript, y sobrevive. Ponlo TODO en UN `<script>`, el último del body — no es un límite del sistema, es para poder cambiarlo después de una pieza. " +
      "Los atributos `on*` sí se borran al guardar. " +
      // ⚰️ AQUÍ ESTABA LA LISTA DE `<iframe>` PERMITIDOS, retirada el 2026-09-04
      // por el mismo motivo y con la misma comprobación que la del Agente doce
      // líneas más arriba: el rediseño CONSERVA el bloque del contrato —no
      // declara `yaLoDiceLaSuperficie`—, y ése la trae completa (las formas de
      // URL de YouTube y de Vimeo, «sólo si el brief te da el enlace», y qué
      // hacer con Spotify o Calendly). Medido sobre el golden ANTES de tocar
      // nada: el prompt del rediseño decía la lista dos veces, en sus líneas
      // 1146 y 1163. Aquí sólo estaba la mitad corta.
      //
      // El comentario de `js-clause-superficies.test.ts` que dice «el rediseño
      // no lleva el bloque de embebidos» describe eso mismo al revés y ya era
      // falso antes de este cambio; su aserción sigue verde porque la forma
      // `maps.google.com/maps?q=` la sigue dando el contrato.
      `${CABLEADO_ES} ` +
      `La página tiene que funcionar sin él. ${SIN_OCULTAR_ES}`,
  },
};

/**
 * Cambia las cláusulas indicadas por su versión permisiva.
 *
 * SIN INTERRUPTOR desde el 2026-08-26: el JavaScript del modelo es del producto.
 * Esta función tomaba un `env` y abría con un `if` que ya nunca era cierto —
 * dejado ahí, un parámetro muerto invita a creer que dirige algo, y un test le
 * pasaba un entorno para volcar una decisión que se ignoraba.
 *
 * 🔴 LANZA si una marca no aparece, y ésa es toda la gracia. `String.replace`
 * con un literal que se desplazó es un no-op SILENCIOSO: devolvería el prompt
 * prohibitivo, el modelo no escribiría nada, y el síntoma sería "el JavaScript
 * del modelo no funciona" en vez de "la marca cambió". Ya nos costó una corrida
 * entera medir un brazo que no existía.
 */
export function swapJsClauses(prompt: string, ids: readonly ClauseId[]): string {
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
