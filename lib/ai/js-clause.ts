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
  | "agente";
  // ⚰️ `rediseno` —la regla nº5 de `lib/agent/redesign.ts`— se fue con el
  // rediseño (Len 2.0: un Write hace lo mismo sin un segundo modelo).

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

// La misma regla para Len, con el porqué que hoy es verdad (2026-09-29). «Si el
// script se descarta» hablaba de la plataforma, y la plataforma ya no descarta
// nada: la cápsula murió el 26/08 y el editor dejó de borrar código el 29/09
// (`deb2acc8`). Lo que sigue pasando es que el script del propio modelo FALLE,
// y entonces lo escondido no se ve nunca. Es un fallo suyo, no nuestro, y por
// eso la regla se queda (memoria `openlen-se-adapta-a-len`). Claude Code la
// tiene igual, en su skill `artifact-design`: «la página completa en reposo; nada se queda en `opacity: 0` esperando a un observador».
// Crear y el Chat conservan la versión de arriba hasta medir Crear.
const SIN_OCULTAR_LEN =
  "Nunca escondas contenido con CSS para revelarlo desde el script: si el script falla, la página llega en blanco.";

// MEDIDO en la corrida del 21/08: de 6 páginas con JavaScript, la del carrito
// cableó sus botones con `onclick="addToCart(1)"` y NINGÚN `addEventListener`.
// El script sobrevivió entero y el carrito quedó mudo: «agregar» no hacía nada.
// Las otras cinco usaron `addEventListener` y funcionan.
//
// El dato ya estaba en el prompt, pero enterrado en la lista de QUÉ MÁS SE BORRA,
// que se lee como una consecuencia para otros scripts. Aquí va como INSTRUCCIÓN.
//
// 🔴 LOS `on*` NO SE BORRAN AL GUARDAR — medido el 2026-09-25, superficie por
// superficie (`lib/publish/el-on-del-modelo.test.ts`). Aquí se decía que los
// quitaba «el SANEADO XSS» y la frase del prompt lo repetía: «se borran al
// guardar, así que un botón cableado así queda mudo». Para lo que escribe el
// MODELO es falso. Crear, el Chat y Len guardan por `gateReservedMarker`, que
// sólo mira `data-slot-path`; `publishToDir` usa la misma puerta; y la CSP que
// antes los bloqueaba en el navegador se retiró el 2026-08-26 (cabecera de
// `crates/html-engine/src/publish/seal.rs`). Publicado y abierto en Chromium,
// el `onclick` del modelo FUNCIONA.
//
// LA RAZÓN que quedaba era la MANO DEL USUARIO: el editor mandaba desde el
// navegador el elemento que tocó, entero, y eso se saneaba; y Deshacer mandaba
// el documento entero y se saneaba entero. Un botón con `onclick` funcionaba el
// día que se publicaba y se quedaba mudo la primera vez que el usuario le
// cambiaba el texto.
//
// 🔴 YA NO ES VERDAD, desde el 2026-09-29: el editor manda lo que cambió —el
// texto de antes y el de después, unos atributos— y Deshacer restaura la copia
// del servidor (`lib/page-engine/cambiar-texto.ts`,
// `el-editor-no-borra-el-codigo.browser.test.ts`). Len ya no recibe esta
// frase (cláusula `agente`). Crear y el Chat SÍ, todavía, y con un porqué que
// ya no es cierto: quitarla ahí espera a medir las páginas de Crear, que es la
// regla para tocar Crear.
const CABLEADO_ES =
  "Cablea los manejadores con `addEventListener` DENTRO del script, no con atributos `onclick=` (ni ningún `on*`): tu guardado los conserva, pero el editor los borra cuando el usuario retoca ese elemento a mano o deshace un cambio, y el botón se queda mudo sin que nadie lo note.";

// EL SEGUNDO PUNTO CIEGO MEDIDO del JavaScript del modelo, y el que no lanza:
// una clase que el script pone y que nadie define en el CSS deja el control
// MUDO — se ejecuta, no falla, no sale en consola, y no se nota. (El primero,
// el `on*` que borra el editor del dueño, lo cubre `CABLEADO_ES`.)
//
// Vivía suelta en `contrato-min`. Se extrae aquí porque desde el 2026-09-04 el
// Agente RETIRA esa viñeta del contrato —sus REGLAS DURAS ya decían todo lo
// demás— y ésta era lo ÚNICO que el contrato aportaba y su regla no. Una frase
// medida no puede perderse al quitar una duplicación.
//
// Desde el 2026-09-29 Len ya no la recibe: se la dice el diagnóstico
// `clase-sin-estilo` después de escribir (ver la cláusula `agente`). Crear y el
// Chat sí, hasta medir Crear.
const DOS_MITADES_ES =
  "Escribe SIEMPRE LAS DOS MITADES: el comportamiento y el CSS del estado que ese comportamiento activa — una clase que el script pone y que nadie define en el CSS deja el control mudo, se ejecuta y no se nota.";
const CABLEADO_EN =
  "Wire handlers with `addEventListener` INSIDE the script, not with `onclick=` (or any `on*`) attributes: your save keeps them, but the editor strips them when the owner touches that element by hand or undoes a change, and the button goes dead without anyone noticing.";

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
      // se nota. El primero (el `on*` que borra el editor) ya lo cubre `CABLEADO_ES`.
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
      "• `<iframe>` — Google Maps, YouTube and Vimeo survive everything, including\n" +
      "  the owner's own hand edits. Write them directly — there is NO\n" +
      "  publish-time transform that turns a link into an embed.\n" +
      '         – map   → `<iframe src="https://maps.google.com/maps?q=<address>&output=embed" loading="lazy">` — no key, no account.\n' +
      '         – video → `<iframe src="https://www.youtube.com/embed/<ID>">` or `https://player.vimeo.com/video/<ID>`, and ONLY when the brief gives you the link: an invented ID is a broken player.\n' +
      "  For anything else (Spotify, Calendly, third-party booking) link out with an\n" +
      "  honest `<a href>`: an `<iframe>` from any other site survives your save, but\n" +
      "  the editor strips it as soon as the owner undoes a change by hand, and it\n" +
      "  vanishes without warning.\n",
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
      // ⚰️ Decía «Ponlo TODO en UN `<script>`… para poder cambiarlo después de
      // una pieza con target="runtime"». Len 2.0 (2026-09-24) edita el script
      // como cualquier otro trozo del fichero, con Edit: esa razón ya no existe.
      "- Puedes escribir el JavaScript de la página, y sobrevive al guardar. " +
      // ⚰️ Aquí iba «Ponlo en un `<script>` al final del body», retirado para
      // Len el 2026-09-29 con el OK de Jesús. Existía por el mismo defecto que
      // `CABLEADO_ES`: un `<script>` dentro de una sección se iba con el saneo
      // en cuanto el usuario retocaba esa sección a mano. El editor ya manda
      // sólo lo que cambió (`el-editor-no-borra-el-codigo.browser.test.ts`),
      // así que dónde va el script lo decide Len, como cualquier desarrollador.
      // ⚰️ Aquí iba `CABLEADO_ES` («usa `addEventListener`, no `onclick`»),
      // retirado para Len el 2026-09-29: existía porque el editor borraba los
      // `on*` al retocar a mano o deshacer, y el editor ya no lo hace (ver
      // `lib/page-engine/cambiar-texto.ts`). Una regla que protege a la
      // plataforma de un defecto suyo no va en el prompt: se arregla la
      // plataforma (memoria `openlen-se-adapta-a-len`).
      // ⚰️ Aquí iba `DOS_MITADES_ES` («escribe SIEMPRE LAS DOS MITADES»),
      // retirado para Len el 2026-09-29 (paso 6 de 2.5): lo hace cumplir el
      // diagnóstico `clase-sin-estilo` (`clasesQueElScriptPoneSinEstilo` en
      // `lib/document/css-wiring.ts`), que le llega tras cada escritura, igual
      // que Claude Code no le pide en el prompt que su código compile y se lo
      // dice el diagnóstico. Pasada gratis: 1 aviso en 1.291 escrituras de Len
      // y 3 en 280 plantillas, los 4 comprobados en Chromium.
      // Crear y el Chat la conservan hasta medir Crear.
      // ⚰️ Aquí iba «La página tiene que funcionar SIN él», retirado para Len el
      // 2026-09-29 con el OK de Jesús. Nació cuando la plataforma tiraba el
      // script (la cápsula, el editor), y ya no lo tira. Además chocaba con
      // LO QUE HAY Y LO QUE NO, que le pide construir en JavaScript el carrito,
      // la calculadora o el juego. `artifact-design` no pide nada parecido.
      `${SIN_OCULTAR_LEN} ` +
      // ⚰️ Aquí iba «Cuando el CSS puro alcanza (`<details>`…), prefiérelo»,
      // retirado el mismo día y por lo mismo: venía de cuando el JavaScript no
      // sobrevivía (las conductas). `artifact-design` no lo tiene. El único dato
      // a su favor (04/09, memoria `el-sobre-no-era-la-causa`): un FAQ salió
      // con `<details>` en 2 de 2. Es estilo, no un fallo; lo vigila Len-Bench.
      // Crear y el Chat conservan las dos frases hasta medir Crear.
      // ⚰️ AQUÍ ESTABA LA LISTA DE `<iframe>` PERMITIDOS, retirada el 2026-09-04.
      // No se pierde: el contrato la trae más completa —las formas de URL de
      // YouTube y de Vimeo, «sólo si el brief te da el enlace», y qué hacer con
      // Spotify o Calendly—, y el Agente conserva ese bloque. Aquí sólo estaba
      // la mitad corta, dicha por segunda vez.
      "COBRAR SÍ SE PUEDE, y sin servidor: si el usuario te da su enlace de pago de Stripe, cablea el botón con `<a href=\"https://buy.stripe.com/…\">`. NUNCA te inventes esa dirección — si no la tiene, explícale que la crea en su panel de Stripe y déjale el botón apuntando a donde te diga. " +
      // 🔴 `/api/d/<almacén>`, SIN subdominio (2026-09-18). Decía
      // `/api/d/<sub>/<almacén>`, y un borrador no sabe con qué subdominio se
      // publicará: en producción Len puso «carrito» en ese hueco y el carrito
      // no guardó nada. La ruta sin subdominio lo saca del host
      // (`app/api/d/[sub]/route.ts`). Y lo de `propio` es el otro medio fallo
      // de ese día: un POST por producto, que se reemplazaban entre sí.
      "GUARDAR TAMBIÉN: declara un almacén en la página (el bloque data-ol-stores) y tu JavaScript escribe y lee con fetch a /api/d/<almacén> —relativa y SIN subdominio: el servidor sabe de qué página viene— — un carrito que sobrevive a recargas, un menú que mantiene el usuario, reseñas que dejan los visitantes. GET devuelve {documentos:[{id,doc}]}; POST con el documento en JSON lo guarda. En un almacén \"propio\" cada visitante tiene UN solo documento y cada POST lo REEMPLAZA: el carrito va ENTERO en un campo de tipo lista, con un POST por cambio —nunca uno por producto, que se pisan y sólo queda el último—, y se lee con GET al cargar la página. " +
      // 🔴 EL «NO» DEL SERVIDOR (2026-09-19). Todo lo de arriba enseña a
      // guardar; nada decía qué hacer cuando la respuesta no es buena, y el
      // JavaScript del modelo pinta primero y no mira. El resultado lo ve el
      // VISITANTE, no el dueño: añade, ve su carrito crecer, recarga, y no hay
      // nada. Lo caza `comprobarAvisoAlVisitante` corriendo la misma página con
      // el almacén lleno y comparando lo que se ve.
      "MIRA LA RESPUESTA DEL SERVIDOR: el POST puede decir que NO —507 si el usuario ha llenado su cuota, 413 si el documento pasa de 16 KB, y la red puede fallar—. Si no vuelve `ok`, díselo al visitante EN LA PÁGINA y no le dejes el cambio pintado como guardado (deshazlo, o píntalo sólo cuando el servidor conteste bien). Pintar primero y no mirar la respuesta es la forma de que alguien pierda su carrito sin enterarse.",
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
