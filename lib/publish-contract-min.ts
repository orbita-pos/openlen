import { PUBLISH_CONTRACT } from "@/lib/design-guidance";

// El contrato MÍNIMO: sólo lo que la publicación impone de verdad.
//
// POR QUÉ EXISTE. `PUBLISH_CONTRACT` (20.231 caracteres, el 85% del prompt de
// creación) se le presenta al modelo diciendo "nothing below tells you what a
// page should look like". Medido, no es cierto: el 45,5% del prompt entero son
// las nueve recetas de conductas, con 28 etiquetas de HTML de ejemplo, y el
// vocabulario dice `nav` 7 veces, `carrusel` 3, `menú` 3, `portafolio` 3,
// `landing` 2 y `hero` 2. Un documento que enseña veintiocho trozos de markup
// no es neutral respecto a la forma de la página.
//
// La sospecha —que el prompt es la jaula, y por eso todas las páginas salen con
// la misma forma— nunca se ha probado: el factorial de ayer comparó el 96,4%
// del prompt contra el 100%, no contra esto.
//
// QUÉ SE CONSERVÓ. Sólo lo que rompe la página si falta:
//   - la viñeta del `<script>` es la MARCA que `swapJsClauses` sustituye por su
//     versión permisiva (lib/ai/js-clause.ts). Tiene que seguir aquí, literal,
//     o la sustitución LANZA.
//   - los `<iframe>` permitidos, que son tres hosts y no una prohibición.
//
//     ⚠️ CORREGIDO el 2026-08-31. Este contrato decía «NINGÚN <iframe>
//     sobrevive» y ofrecía a cambio un `<a href>` que «se transforma al
//     publicar» en mapa o reproductor. Las dos mitades eran falsas: crear corre
//     con `sanitize: false`, y `bakeVideoEmbeds`/`bakeMapEmbeds` salieron de la
//     tubería el 2026-08-26 (`3a4e2a97`) sin que nadie tocara este texto. El
//     modelo obedecía, escribía el enlace, y toda página de negocio local nacía
//     SIN MAPA. La lista real vive en crates/html-engine/src/sanitize/
//     elements.rs (`IFRAMES_PERMITIDOS`): host exacto + prefijo de ruta.
//
//     ⚠️ Y CORREGIDO OTRA VEZ el 2026-09-25: decía «Cualquier otro se borra al
//     guardar». Falso para lo que escribe el modelo: la lista la aplica
//     `sanitizeForPublish`, y Crear, el Chat, Len y `publishToDir` pasan por
//     `gateReservedMarker`. Un iframe de Spotify llega al release. Lo que sí
//     lo borra es el «Deshacer» del editor, que guarda el documento entero
//     saneado. Medido en `lib/publish/el-iframe-del-modelo.test.ts`, que
//     también mide por qué NO se filtra en la puerta del modelo: su script
//     crea el mismo iframe en la publicada, así que no sería una frontera.
//   - `publishToDir` RECHAZA `data-slot-path=`
//   ⚰️ AQUÍ DECÍA «el horneado de fotos necesita `data-ol-photo`», y era la
//     razón por la que se conservaba una viñeta que ordenaba dejar un hueco de
//     degradado marcado. RETIRADA ENTERA el 2026-09-04, las dos cosas:
//
//     El horneado ya no existe — `4feb19d9` retiró `photograph`, y
//     `lib/imagery/photograph.ts` (el único que llamaba a `extractPhotoSlots` /
//     `applyPhotoSlots`) se borró con este barrido. La etapa 1 de
//     `lib/page-engine/prepare.ts` está retirada. O sea que el marcador no
//     alimenta a nadie y el hueco se quedaba de degradado para siempre, en las
//     CUATRO superficies. El síntoma estaba MEDIDO y escrito en otro fichero:
//     `app/api/templates/ai-design/route.ts` — «daba CAJAS GRISES».
//
//     Decisión de Jesús: la biblioteca de fotos es del USUARIO, no de la IA.
//     Así que el contrato pide la página TERMINADA y el dueño cambia después
//     cualquier área de imagen por su foto — la puerta que lo permite vive en
//     `use-image-replace.ts` / `drop-place-core.ts`.
//   - un href sin esquema es relativo, y una ruta desconocida sirve la HOME
//     con un 200 — el enlace se rompe EN SILENCIO ([[caddy-broken-links-serve-home]])
//   - el vocabulario de tokens, del que dependen los controles de Tema del
//     editor — y desde el 2026-09-04 se dice EN EL ESPACIO QUE ESOS CONTROLES
//     LEEN, `--ol-*`:
//
//     🔴 EL PUENTE SE APAGÓ Y LA JAULA SE QUEDÓ. El contrato ordenaba `--bg /
//     --fg / --accent`, y toda la maquinaria de tema —los Looks del inspector,
//     `cambiar_tema`, `aplicar_tematica`, el conmutador claro/oscuro— lee el
//     OTRO espacio, `--ol-*`. Lo que unía los dos era la cadena born-canonical
//     (`crates/html-engine/src/normalize/modes.rs`, tabla `ROLE_TOKENS`), y
//     `5bfb2272` la apagó para lo del modelo — con razón, porque reescribía el
//     sistema de diseño entero. Su propio mensaje ya avisó del precio: «una
//     página que no nace con los tokens no responde al selector de Tema».
//
//     Lo que ese mensaje no dijo: el vocabulario obligatorio era LA OTRA MITAD
//     de ese puente. Siguió en pie restringiendo cómo el modelo escribe su CSS,
//     y su contrapartida ya no llegaba. Una jaula sin premio.
//
//     El arreglo es de ENTRADA y sólo de entrada: cero código tocando lo que el
//     modelo escribió, ninguna cadena reactivada. La página NACE leyendo el
//     espacio del editor. Tres detalles que no son cosmética:
//       · `--ol-radius` va como `calc(<base> * var(--ol-r-scale, 1))` porque el
//         control de redondeo escribe un FACTOR, no una longitud — es el mismo
//         patrón que ya usa `lib/publish/optimize-html.ts`. Sin el `calc`, los
//         otros cuatro controles funcionan y el del redondeo no.
//       · el bloque oscuro pasa de `:root.dark` a
//         `:root[data-ol-mode="dark"]`, que es lo que el editor conmuta de
//         verdad (`applyThemeTokensToHtml` lo escribe como ATRIBUTO sobre
//         `<html>`, y `readThemeModeFromHtml` lo lee ahí). `:root.dark` era
//         justo lo que la cadena apagada convertía.
//       · `lib/contract/lint.ts` NO se toca: sus `REQUIRED_TOKENS` son los
//         nombres pelados, pero ese linter es una puerta de INGREDIENTES
//         (`templates:add`, `contract:lint` sobre un fichero), nunca corre
//         sobre lo que el modelo genera, y las plantillas curadas siguen en
//         `--bg`. Los `--ol-*` ya le son canónicos vía `OL_MIRRORED`.
//
// QUÉ SE QUITÓ, y por qué no es contrato:
//   - las 9 recetas de conductas y el carrusel (9.946 car.): la CAPACIDAD es
//     real, pero enseñarla entera en cada página es enseñar markup. Si este
//     contrato gana, van inyectadas SÓLO cuando el brief pide ese
//     comportamiento.
//   - "landing pages" / "public marketing pages": encuadra el género y activa
//     el prior de conversión incluso para un ensayo o una carta.
//   - "lift-on-hover 50-150ms", "una modalidad por página": gusto nuestro.
//   - los ejemplos (taquería, tacos al pastor, portafolio): ceban el contenido.
//
// Sin las palabras `landing`, `marketing`, `nav`, `hero`, `card`, `CTA` ni
// `footer`, y sin un solo ejemplo de HTML.

// EN INGLÉS desde la traducción de lo que lee Len (rama len-agente-2026-en,
// 2026-10-02): Jesús decidió que lo compartido con Crear se traduce para los
// dos. Cada regla conserva su peso (NINGÚN → NO, SÓLO → ONLY, las mayúsculas
// donde estaban); la tabla, en plans/len-agente-2026/notas/traduccion-tabla-de-reglas.md.
// Los ejemplos de ids y rutas pasan a inglés (`#pricing`, `/services`): son
// ejemplos, no datos. Y ninguna frase empieza por «Write»: en inglés es el
// nombre de la herramienta, y «Write them directly» se leía como «usa Write»
// (en el brazo «sólo terminal», una herramienta que no tiene). Por eso «Put
// them in directly» y «Use a normal `<form>`».
export const PUBLISH_CONTRACT_MIN = `WHAT PUBLISHING REQUIRES

None of this says WHAT to build: not the sections, not their order, not what the page tells. These are the conditions for the document to survive being published, and at the end the level of finish that is expected.

• ONE complete, self-contained \`<!doctype html>\` document. No JSX and no markup from any framework. The first character of your response is \`<\` and the last one is the closing of \`</html>\`: no preamble, no notes, no markdown fences.
• Tailwind via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\` in the \`<head>\`.
• Google Fonts via \`<link rel="stylesheet" href="https://fonts.googleapis.com/…">\` in the \`<head>\`. Any family in the catalog works; load every one you use.
• Your own CSS goes in a \`<style>\` inside the \`<head>\`.
• NO JavaScript survives. Every \`<script>\` —except Tailwind's— and every \`on*\` attribute are DELETED before the document is saved. Whatever has to move or respond is solved without code: \`<details>\`/\`<summary>\`, a hidden checkbox with \`peer-checked:\`, \`:target\`, \`@keyframes\`, \`transition\`. A control that would only work with a script arrives dead.
• \`<iframe>\`s from Google Maps, YouTube and Vimeo survive everything, including what the user edits by hand. Put them in directly, there is no transformation at publish time:
  – MAP: \`<iframe src="https://maps.google.com/maps?q=<address>&output=embed" loading="lazy">\` — it needs no key and no account. If the business has a physical address, put it where you give the contact details: a local business without a map is half done.
  – VIDEO: \`<iframe src="https://www.youtube.com/embed/<ID>">\` or \`https://player.vimeo.com/video/<ID>\`, and ONLY if the brief gives you the link — a made-up ID is a broken player.
  For anything else (Spotify, Calendly, third-party bookings), link with an honest \`<a href>\`: an \`<iframe>\` from another site survives your save, but the editor deletes it as soon as the user undoes a change by hand, and it disappears without warning.
• FORMS WORK, and they are the only thing on this list that ADDS something instead of taking it away: at publish time, OpenLen bakes the \`<form>\`'s \`action\` into it, and what the visitor sends reaches the user's email and their inbox. Use a normal \`<form>\` —\`<label>\` + \`<input name="…">\` + \`<button type="submit">\`— and DON'T give it an \`action\`, a \`method\` or JavaScript. An \`onsubmit\` that calls \`preventDefault()\` or returns \`false\` CANCELS the real submission: the visitor sees your thank-you message, the user receives nothing and neither of them finds out.
• No \`data-slot-path=\` attribute anywhere.
• Every internal link has to ARRIVE: if you write \`href="#pricing"\`, the page needs its \`id="pricing"\`. An anchor to a section that doesn't exist is a dead button, invisible in the screenshot. Typical: there are no accounts behind these pages, so a "Log in" only works if it points OUTSIDE, to its real URL.

IMAGES
• Illustrations, logos and icons: inline SVG.
• Every inline SVG and every image carry \`class="max-w-full h-auto"\`. Without it a fixed width does NOT shrink, and inside a card it overflows on mobile even when the rest of the page fits.
• Deliver the page FINISHED: no gaps waiting for an image to arrive later, because none arrives. Where a photograph would go, solve the area yourself — an SVG illustration, a composition, whatever suits it. The user can later swap any image area for a photo of their own from the editor's library.
• No external image URL (unsplash, picsum, placehold.co…), not even one that comes in the request: a server we don't control is a 404 on the published page, and that the visitor does see.

LINKS
• Any address the brief brings is real data: copy it literally, character for character. Absolute and with a scheme — \`instagram.com/x\` is written \`https://instagram.com/x\`, an email goes with \`mailto:\`.
• An \`href\` without a scheme is a relative path, and an unknown path returns the home page with a 200 instead of an error: the link breaks without anyone noticing.
• If the brief gives no destination, \`href="#"\`. Don't make up accounts, addresses, emails or phone numbers.
• MORE THAN ONE PAGE: almost everything fits in one with sections (\`#section\`), and that is the default answer. When the brief asks for real pages, the menu link carries a ONE-segment relative path —\`href="/services"\`— and that page gets created; the link text is its title. Lowercase, no accents or spaces, four at most besides the home page.

COLOR, SHAPE AND TYPE — required vocabulary
Every color, radius and family comes from a CSS custom property, declared in \`:root\` and used with \`var()\`. Never repeat a literal color across the page. The names carry the \`--ol-\` prefix: they are the ones the editor's Theme controls write, so a page that uses them responds to the user's picker instead of staying deaf.
  Background : --ol-bg · --ol-surface · --ol-surface-2
  Text       : --ol-fg · --ol-fg-muted · --ol-fg-faint
  Line       : --ol-border · --ol-border-strong
  Accent     : --ol-accent · --ol-accent-r (its R,G,B triplet) · --ol-accent-ink (what goes ON TOP of the accent)
  Shape      : --ol-radius, declared as \`calc(<your base> * var(--ol-r-scale, 1))\` — the editor's rounding control moves that factor
  Type       : --ol-font-display · --ol-font-body · --ol-font-mono
No \`#rrggbb\` literals outside the \`:root\` blocks. Also emit \`:root[data-ol-mode="dark"] { … }\` redefining those tokens with dark values thought out by hand, not a mechanical inversion: that attribute on \`<html>\` is the one the editor toggles.

SIZE
• Readable and usable from 360 px wide.

CRAFT
None of this says which sections the page has or in what order. It is the level of finish expected of anything you publish.
• Depth: raised surfaces separate from the background with a soft shadow, never with a bright border. Dividers are hairline, at the low alpha of \`--ol-border\`.
• ONE single accent, used sparingly. An accent that appears everywhere stops being an accent.
• Type with character: pair a display family with a reading one, and let the display one carry the personality of this request — a car repair shop, a second-hand bookshop and a financial dashboard aren't lettered the same way. No default fonts.
• Rhythm: generous vertical space between blocks, and reading text no wider than about 65 characters per line.
• ONE mode per page — dark, light or cream — chosen by what the request suggests. Emit the dark block anyway so the editor can toggle, but DON'T put a visible theme-switch button: nobody who visits a business's page expects to find one.`;

/**
 * LA PALANCA, en un solo sitio.
 *
 * 🔴 POR QUÉ AQUÍ Y NO EN CADA SUPERFICIE. `OPENLEN_MIN_CONTRACT` lo leía SÓLO
 * `crear`, así que las otras tres —el Chat, el Agente y el rediseño— mandaban el
 * contrato entero sin que nadie lo hubiera decidido: simplemente nunca se les
 * cableó. Y la vez anterior que una capacidad se leyó por superficie, cada una
 * entendió una cosa distinta y ése fue el hallazgo 1 del 2026-08-26.
 *
 * La palanca es OPT-OUT, la misma semántica que los kill-switches de
 * `lib/publish/kill-switches.ts`: la ausencia ENCIENDE el mínimo, y sólo el
 * literal "0" devuelve el contrato completo. Un interruptor que hay que
 * acordarse de encender no es un camino, es una nota.
 */
export function contratoMinimoActivo(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.OPENLEN_MIN_CONTRACT?.trim() !== "0";
}

/**
 * Cambia `PUBLISH_CONTRACT` por su mínimo dentro de un prompt.
 *
 * Devuelve además `min`, porque quien llama lo NECESITA: con el contrato
 * mínimo, el bloque de las 9 conductas ya no está en el texto, y pedirle a
 * `swapJsClauses` la marca `conductas` LANZA. Las dos decisiones son la misma
 * decisión, y devolverlas juntas es lo que impide que se separen.
 *
 * LANZA si la sustitución no ocurre. `String.replace` que no encuentra su
 * literal devuelve la cadena INTACTA: sin esta guarda, un retoque de redacción
 * en `PUBLISH_CONTRACT` dejaría la palanca sin efecto y nadie se enteraría — el
 * síntoma sería «el contrato mínimo ya no mejora», no «la sustitución no
 * ocurrió».
 */
export function conContratoMinimo(
  prompt: string,
  quien: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { prompt: string; min: boolean } {
  if (!contratoMinimoActivo(env)) return { prompt, min: false };
  const recortado = prompt.replace(PUBLISH_CONTRACT, PUBLISH_CONTRACT_MIN);
  if (recortado === prompt) {
    throw new Error(
      `${quien}: el contrato mínimo está activo pero PUBLISH_CONTRACT no apareció en el prompt — la sustitución no ocurrió.`,
    );
  }
  return { prompt: recortado, min: true };
}

/**
 * EL CONTRATO NO LO LEEN CUATRO SUPERFICIES IGUALES — 2026-09-04.
 *
 * MEDIDO sobre el golden (que es lo que producción manda, no la constante):
 * dos de sus frases eran FALSAS en las superficies que EDITAN, y una frase
 * caducada dentro de un prompt no es suciedad como un comentario viejo, es una
 * INSTRUCCIÓN. Las dos:
 *
 *   1. «El primer carácter de tu respuesta es `<` y el último es el cierre de
 *      `</html>`». Verdad en `crear` y en el rediseño, que devuelven el
 *      documento entero. FALSA en el Agente —cuya respuesta son llamadas a
 *      herramientas más prosa para el usuario— y contradecía de frente su
 *      propio bloque TONO 130 líneas más arriba. En el Chat es verdad sólo en
 *      Modo B, así que el contrato tampoco puede afirmarla.
 *
 *   2. «el enlace del menú lleva una ruta relativa de UN tramo —href="/servicios"—
 *      y esa página se crea». Verdad SÓLO en `crear`, donde las subpáginas
 *      declaradas se construyen. En las otras tres escribir ese enlace no crea
 *      nada: la ruta no existe, Caddy sirve la portada con un 200 y el enlace
 *      se rompe EN SILENCIO. O sea que el contrato enseñaba a cometer
 *      exactamente el fallo que otra de sus viñetas advierte.
 *
 * Y `yaLoDiceLaSuperficie` cierra la otra mitad: el prompt del Agente decía
 * ONCE reglas dos veces (algunas tres y cinco), porque sus REGLAS DURAS y este
 * contrato cubren lo mismo — tres frases eran idénticas byte a byte. Quitar el
 * bloque del contrato en la superficie que ya lo dice MEJOR no pierde nada:
 * cada retirada se hizo comparando las dos redacciones primero.
 *
 * SÓLO POR LA RUTA DEL MÍNIMO, y no es pereza: `PUBLISH_CONTRACT` está en
 * INGLÉS (es un corte de `DESIGN_GUIDANCE`), así que estas marcas no existen
 * ahí. La palanca `OPENLEN_MIN_CONTRACT=0` es una salida de emergencia que
 * nadie corre, y su texto se queda como estaba. Misma decisión que tomó el
 * golden por el mismo motivo.
 */
export type BloqueDelContrato = "javascript" | "enlaces" | "data-slot-path";

export interface FormaDeLaSuperficie {
  /** ¿La RESPUESTA del modelo ES el documento entero? `crear` y el rediseño sí;
   *  el Agente nunca, y el Chat sólo en Modo B — para los dos últimos el
   *  contrato deja de afirmar nada y remite al bloque de la superficie. */
  readonly respuestaEsElDocumento: boolean;
  /** ¿Escribir `href="/slug"` CREA esa página? SÓLO `crear`. */
  readonly elEnlaceCreaLaPagina: boolean;
  /**
   * ¿Esta superficie ESCRIBE el `<head>` de la página, o recibe uno hecho?
   *
   * Cuatro viñetas del contrato son órdenes de CONSTRUCCIÓN — «Tailwind por CDN
   * en el `<head>`», «Google Fonts por `<link>` en el `<head>`», «tu CSS propio
   * va en un `<style>` del `<head>`» y «emite también el bloque oscuro». Un
   * turno de edición no construye ningún `<head>`: recibe un documento que ya
   * trae las tres cosas, y la orden sólo puede salirle mal —duplicando el
   * script de Tailwind o la hoja de fuentes que ya estaban—.
   *
   * ⚠️ ES UNA PREGUNTA DISTINTA de `respuestaEsElDocumento`, aunque hoy las
   * cuatro superficies contesten igual a las dos. El Chat responde `false` a la
   * primera porque su modo por defecto son ops, pero en Modo B SÍ devuelve un
   * documento entero — así que el texto de recambio está redactado para valer
   * en los dos modos: dice DÓNDE viven esas tres cosas sin ordenar crearlas.
   * Declararlas por separado es lo que impide que un cambio en una arrastre a
   * la otra sin que nadie lo decida.
   */
  readonly escribeElHead: boolean;
  /**
   * ¿La guía manda sólo en lo que la superficie CREA? Sólo el Agente (H8,
   * 2026-09-26). «Si la página aún no lo define, escríbelo tú», sobre una
   * página que ya tiene su diseño y no usa tokens, se cumple reescribiéndola:
   * en E las tres taquerías hicieron un Write entero y perdieron el lema del
   * dueño. Con esto el bloque oscuro se escribe en la página que el Agente
   * crea; en la que ya existe manda cómo está escrita ella (lo dice su prompt).
   * El Chat no lo enciende: no se ha medido ahí.
   */
  readonly laGuiaEsParaLoQueCrea?: boolean;
  /** Bloques que ESTA superficie ya dice mejor por su cuenta. */
  readonly yaLoDiceLaSuperficie?: readonly BloqueDelContrato[];
  /** Reglas que ESTA superficie ya no recibe — ver `ReglaRetirada`. */
  readonly retira?: readonly ReglaRetirada[];
}

/**
 * REGLAS QUE PROTEGÍAN A LA PLATAFORMA DE UN DEFECTO SUYO — 2026-09-29.
 *
 * La regla de Jesús: OpenLen se adapta a Len, no al revés (memoria
 * `openlen-se-adapta-a-len`). Dos frases del contrato no protegían al modelo
 * de un fallo SUYO, sino al editor de uno NUESTRO, y los dos se arreglaron:
 *
 *   - `vocabulario-ol`: «los nombres llevan el prefijo `--ol-`», con su lista y
 *     el `:root[data-ol-mode="dark"]` obligatorio. Existía porque el Tema sólo
 *     sabía escribir `--ol-*`; ahora descubre qué variables lee la página y
 *     escribe en ésas, y conmuta su propio interruptor oscuro
 *     (`el-tema-sigue-a-la-pagina.browser.test.ts`). Lo que se queda es lo que
 *     el Tema de verdad necesita —los colores en variables de `:root`— y lo
 *     que pide Claude Code en `artifact-design`: un sistema de tokens propio.
 *   - `iframes-que-borraba-el-editor`: «Spotify, Calendly… enlázalos, porque
 *     el editor borra el `<iframe>` en cuanto el usuario deshace». El editor ya
 *     manda sólo lo que cambió (`el-iframe-del-modelo.test.ts`).
 *
 * Sólo Len, con el OK de Jesús. Crear y el Chat las siguen recibiendo hasta
 * que se mida Crear: es la regla para tocar Crear.
 */
export type ReglaRetirada = "vocabulario-ol" | "iframes-que-borraba-el-editor";

const LOS_IFRAMES_SOBREVIVEN =
  "• The `<iframe>`s you write survive everything: saving, publishing and whatever the " +
  "user edits by hand. Put them in directly, there is no transformation at publish time:";

/** El bloque COLOR sin el espacio de nombres `--ol-`. `creas` = la guía manda
 *  sólo en lo que la superficie crea (`laGuiaEsParaLoQueCrea`). */
function colorConSusNombres(creas: boolean): string {
  const oscuro = creas
    ? "On a page you create yourself, also write its dark version"
    : "If the page doesn't have one yet, write its dark version yourself";
  return (
    "COLOR, SHAPE AND TYPE\n" +
    "Every color, radius and family comes from a CSS custom property, declared in `:root` and " +
    "used with `var()`, with names of your choosing. Never repeat a literal color across the page: " +
    "no `#rrggbb` literals outside the `:root` blocks. The editor's Theme controls write into those " +
    "variables —they find them by how the page uses them: the `body`'s background and color, the " +
    "buttons' background, the `border-radius` values, the type of the `body` and of the headings—, " +
    "so a color written by hand into a rule is one they can't change.\n" +
    `${oscuro}: a block that redefines those variables with dark values thought out by hand —not a ` +
    "mechanical inversion— under a class or an attribute of `<html>` (`:root.dark`, " +
    '`:root[data-theme="dark"]`…). That is what the editor\'s switch turns on; one that depends only ' +
    "on `prefers-color-scheme` is one it can't turn on."
  );
}

const RESPUESTA_NO_ES_EL_DOCUMENTO =
  "• The page is ONE complete, self-contained `<!doctype html>` document. No JSX and " +
  "no markup from any framework. The format of YOUR response isn't set by this guide: " +
  "your own instruction block sets it.";

const EL_HEAD_YA_EXISTE =
  "• The three things the look depends on live in the `<head>`: Tailwind via CDN " +
  "(`<script src=\"https://cdn.tailwindcss.com\"></script>`), the Google Fonts stylesheets " +
  "(`<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/…\">`) and the page's own CSS " +
  "in a `<style>`. The document you edit already has them: add what you are missing INSIDE them " +
  "—a new family, new rules— instead of duplicating them.";

const EL_BLOQUE_OSCURO_SI_FALTA =
  'If the page doesn\'t define it yet, write it yourself: `:root[data-ol-mode="dark"] { … }` with ' +
  "those tokens in dark values thought out by hand, not a mechanical inversion — that attribute " +
  "on `<html>` is the one the editor toggles.";

const EL_BLOQUE_OSCURO_EN_LO_QUE_CREAS =
  'On a page you create yourself, write it too: `:root[data-ol-mode="dark"] { … }` with those ' +
  "tokens in dark values thought out by hand, not a mechanical inversion — that attribute on " +
  "`<html>` is the one the editor toggles.";

const EL_ENLACE_NO_CREA_LA_PAGINA =
  "• MORE THAN ONE PAGE: almost everything fits in one with sections (`#section`), and that " +
  "is the default answer. Writing a link to `/another` does NOT create that page: if that " +
  "path doesn't exist, the site serves the home page with a 200 and the link breaks SILENTLY. " +
  "Link only to pages that already exist.";

/** De `desde` hasta `hasta` (exclusiva), sustituido. LANZA si falta cualquiera
 *  de las dos marcas: una redacción retocada no puede dejar el ajuste sin
 *  efecto en silencio, que es como esta clase de defecto vive años. */
function corta(
  texto: string,
  quien: string,
  que: string,
  desde: string,
  hasta: string,
  conQue: string,
): string {
  const i = texto.indexOf(desde);
  if (i === -1) {
    throw new Error(
      `${quien}: el ajuste "${que}" no encontró su marca inicial en el contrato — ` +
        "cambió de redacción. Actualiza lib/publish-contract-min.ts; NO lo ignores.",
    );
  }
  const j = hasta === "\n" ? texto.indexOf("\n", i) : texto.indexOf(hasta, i);
  if (j === -1) {
    throw new Error(`${quien}: el ajuste "${que}" no tiene fin — falta la marca final.`);
  }
  // Una viñeta que se RETIRA se lleva su salto de línea; si no, deja un hueco.
  const fin = conQue === "" && hasta === "\n" ? j + 1 : j;
  return texto.slice(0, i) + conQue + texto.slice(fin);
}

/** El contrato mínimo, dicho para ESTA superficie. */
export function contratoParaSuperficie(
  prompt: string,
  quien: string,
  forma: FormaDeLaSuperficie,
): string {
  const quita = forma.yaLoDiceLaSuperficie ?? [];
  // Incoherencia que sí puede pasar y sería muda: una superficie que CREA
  // páginas necesita el bloque ENLACES, porque la viñeta que lo explica vive
  // dentro. Se dice ahora y no se descubre leyendo un prompt raro.
  if (forma.elEnlaceCreaLaPagina && quita.includes("enlaces")) {
    throw new Error(
      `${quien}: una superficie que crea páginas no puede quitar el bloque ENLACES del contrato.`,
    );
  }
  let out = prompt;
  if (!forma.respuestaEsElDocumento) {
    out = corta(
      out,
      quien,
      "respuesta",
      "• ONE complete, self-contained `<!doctype html>` document.",
      "\n",
      RESPUESTA_NO_ES_EL_DOCUMENTO,
    );
  }
  if (!forma.escribeElHead) {
    // Las tres órdenes de construcción, fundidas en UNA que dice dónde viven
    // esas cosas. Cada corte se ancla en el principio de SU propia línea y no
    // en la viñeta siguiente: la de después es la del JavaScript, que el
    // Agente RETIRA más abajo, y encadenar los dos ajustes haría que el orden
    // de este bloque decidiera si el otro lanza.
    out = corta(out, quien, "head", "• Tailwind via CDN:", "\n", EL_HEAD_YA_EXISTE);
    out = corta(out, quien, "fuentes", "• Google Fonts via", "\n", "");
    out = corta(out, quien, "css-propio", "• Your own CSS goes in a", "\n", "");
    // El bloque oscuro deja de ser una orden y pasa a ser condicional, que es
    // lo único que un turno de edición puede ejecutar.
    out = corta(
      out,
      quien,
      "bloque-oscuro",
      'Also emit `:root[data-ol-mode="dark"] { … }`',
      "\n",
      forma.laGuiaEsParaLoQueCrea ? EL_BLOQUE_OSCURO_EN_LO_QUE_CREAS : EL_BLOQUE_OSCURO_SI_FALTA,
    );
    // …y entonces OFICIO no puede seguir ordenándolo por segunda vez, o el
    // contrato se contradiría a sí mismo a doce líneas de distancia.
    out = corta(
      out,
      quien,
      "oficio-oscuro",
      "Emit the dark block anyway so the editor can toggle, but DON'T",
      " put a visible",
      "DON'T",
    );
  }
  // El bloque ENLACES se lleva dentro la viñeta de las páginas: si la
  // superficie lo retira entero, la frase falsa se va con él y no hay nada que
  // sustituir.
  if (!forma.elEnlaceCreaLaPagina && !quita.includes("enlaces")) {
    out = corta(out, quien, "paginas", "• MORE THAN ONE PAGE:", "\n", EL_ENLACE_NO_CREA_LA_PAGINA);
  }
  if (quita.includes("javascript")) {
    // La viñeta ya pasó por `swapJsClauses`, así que la marca es su versión
    // permisiva. Por eso este ajuste va DESPUÉS del intercambio y nunca antes:
    // quitarla primero dejaría al intercambio sin su marca y lanzaría.
    out = corta(out, quien, "javascript", "• JavaScript: tu código SOBREVIVE a la publicación", "\n", "");
  }
  if (quita.includes("data-slot-path")) {
    out = corta(out, quien, "data-slot-path", "• No `data-slot-path=` attribute anywhere.", "\n", "");
  }
  if (quita.includes("enlaces")) {
    out = corta(
      out,
      quien,
      "enlaces",
      "LINKS\n• Any address the brief brings",
      "COLOR, SHAPE AND TYPE",
      "",
    );
  }
  const retira = forma.retira ?? [];
  if (retira.includes("iframes-que-borraba-el-editor")) {
    // La primera línea decía «Maps, YouTube y Vimeo sobreviven a todo», que
    // sin la de Spotify debajo se lee como «los demás no». Sobreviven todos.
    out = corta(
      out,
      quien,
      "iframes",
      "• `<iframe>`s from Google Maps, YouTube and Vimeo survive everything",
      "\n",
      LOS_IFRAMES_SOBREVIVEN,
    );
    out = corta(out, quien, "spotify", "  For anything else (Spotify, Calendly", "\n", "");
  }
  if (retira.includes("vocabulario-ol")) {
    // Va DESPUÉS del ajuste del bloque oscuro de arriba, que lanza si no
    // encuentra su línea: éste sustituye la sección entera, con esa línea ya
    // cambiada dentro.
    out = corta(
      out,
      quien,
      "vocabulario-ol",
      "COLOR, SHAPE AND TYPE — required vocabulary",
      "\n\nSIZE",
      colorConSusNombres(!!forma.laGuiaEsParaLoQueCrea),
    );
    out = corta(
      out,
      quien,
      "separadores-ol",
      "at the low alpha of `--ol-border`",
      ".",
      "at the low alpha of your border color",
    );
  }
  return out;
}
