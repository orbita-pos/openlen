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
//   - `npm run contract:lint` exige el vocabulario de tokens, y de él dependen
//     los controles de tema del editor
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

export const PUBLISH_CONTRACT_MIN = `LO QUE LA PUBLICACIÓN IMPONE

Nada de esto habla de cómo debe verse la página. Son las condiciones para que el documento sobreviva al publicarse.

• UN documento \`<!doctype html>\` completo y autocontenido. Nada de JSX ni de marcado de ningún framework. El primer carácter de tu respuesta es \`<\` y el último es el cierre de \`</html>\`: sin preámbulo, sin notas, sin vallas de markdown.
• Tailwind por CDN: \`<script src="https://cdn.tailwindcss.com"></script>\` en el \`<head>\`.
• Google Fonts por \`<link rel="stylesheet" href="https://fonts.googleapis.com/…">\` en el \`<head>\`. Cualquier familia del catálogo vale; carga todas las que uses.
• Tu CSS propio va en un \`<style>\` dentro del \`<head>\`.
• NINGÚN JavaScript sobrevive. Todo \`<script>\` —salvo el de Tailwind— y todo atributo \`on*\` se BORRAN antes de guardar el documento. Lo que deba moverse o responder se resuelve sin código: \`<details>\`/\`<summary>\`, un checkbox oculto con \`peer-checked:\`, \`:target\`, \`@keyframes\`, \`transition\`. Un control que sólo funcionaría con un script llega muerto.
• Los \`<iframe>\` sobreviven SÓLO desde esta lista corta: Google Maps, YouTube y Vimeo. Cualquier otro se borra al guardar. Escríbelos directamente, no hay ninguna transformación al publicar:
  – MAPA: \`<iframe src="https://maps.google.com/maps?q=<dirección>&output=embed" loading="lazy">\` — no necesita clave ni cuenta. Si el negocio tiene dirección física, ponlo donde des el contacto: un negocio local sin mapa está a medias.
  – VÍDEO: \`<iframe src="https://www.youtube.com/embed/<ID>">\` o \`https://player.vimeo.com/video/<ID>\`, y SÓLO si el brief te da el enlace — un ID inventado es un reproductor roto.
  Para cualquier otra cosa (Spotify, Calendly, reservas de terceros), no finjas un embebido: enlaza con un \`<a href>\` honesto.
• Ningún atributo \`data-slot-path=\` en ninguna parte.
• Ninguna interfaz de acceso, registro o cuenta: estas páginas no tienen aplicación detrás, así que un enlace de entrada no lleva a ningún sitio.

IMÁGENES
• Ilustraciones, marcas e iconos: SVG en línea.
• Entrega la página TERMINADA: nada de huecos a la espera de una imagen que llegue después, porque no llega ninguna. Donde iría una fotografía, resuelve tú el área — una ilustración en SVG, una composición, lo que le siente. El dueño puede cambiar después cualquier área de imagen por una foto suya desde la biblioteca del editor.
• Ninguna URL de imagen externa (unsplash, picsum, placehold.co…), ni siquiera una que venga en el encargo: un servidor que no controlamos es un 404 en la página publicada, y eso el visitante sí lo ve.

ENLACES
• Cualquier dirección que traiga el brief es un dato real: cópiala literal, carácter por carácter. Absoluta y con esquema — \`instagram.com/x\` se escribe \`https://instagram.com/x\`, un correo va con \`mailto:\`.
• Un \`href\` sin esquema es una ruta relativa, y una ruta desconocida devuelve la portada con un 200 en vez de un error: el enlace se rompe sin que nadie lo note.
• Si el brief no da destino, \`href="#"\`. No inventes cuentas, direcciones, correos ni teléfonos.
• MÁS DE UNA PÁGINA: casi todo cabe en una con secciones (\`#seccion\`), y ésa es la respuesta por defecto. Cuando el brief pida páginas de verdad, el enlace del menú lleva una ruta relativa de UN tramo —\`href="/servicios"\`— y esa página se crea; el texto del enlace es su título. Minúsculas, sin acentos ni espacios, cuatro como mucho además de la portada.

COLOR, FORMA Y TIPOGRAFÍA — vocabulario obligatorio
Todo color, radio y familia sale de una propiedad personalizada de CSS, declarada en \`:root\` y usada con \`var()\`. Nunca repitas un color literal por la página.
  Fondo  : --bg · --surface · --surface-2
  Texto  : --fg · --fg-muted · --fg-faint
  Línea  : --border · --border-strong
  Acento : --accent · --accent-r (su tripleta R,G,B) · --accent-ink (lo que va ENCIMA del acento)
  Forma  : --radius
  Letra  : --font-display · --font-body · --font-mono
Nada de literales \`#rrggbb\` fuera de los bloques \`:root\`. Emite también \`:root.dark { … }\` redefiniendo esos tokens con valores oscuros pensados a mano, no una inversión mecánica.

TAMAÑO
• Legible y usable desde 360 px de ancho.

OFICIO
Nada de esto dice qué secciones lleva la página ni en qué orden. Es el nivel de acabado que se espera de cualquier cosa que publiques.
• Profundidad: las superficies elevadas se separan del fondo con sombra suave, nunca con un borde brillante. Los separadores son de un pelo, a la alfa baja de \`--border\`.
• UN solo acento, usado poco. Un acento que aparece en todas partes deja de ser un acento.
• Tipografía con carácter: empareja una familia de titulares con otra de lectura, y que la de titulares lleve la personalidad de este encargo — un taller mecánico, una librería de viejo y un panel financiero no se letran igual. Sin fuentes por defecto.
• Ritmo: espacio vertical generoso entre bloques, y texto de lectura que no pase de unos 65 caracteres por línea.
• UNA modalidad por página — oscura, clara o crema — elegida por lo que el encargo sugiere. Emite igualmente el bloque oscuro para que el editor pueda conmutar, pero NO pongas un botón visible de cambio de tema: nadie que entre a la página de un negocio espera encontrarlo.`;

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
  /** Bloques que ESTA superficie ya dice mejor por su cuenta. */
  readonly yaLoDiceLaSuperficie?: readonly BloqueDelContrato[];
}

const RESPUESTA_NO_ES_EL_DOCUMENTO =
  "• La página es UN documento `<!doctype html>` completo y autocontenido. Nada de JSX " +
  "ni de marcado de ningún framework. El formato de TU respuesta no lo fija esta guía: " +
  "lo fija tu propio bloque de instrucciones.";

const EL_ENLACE_NO_CREA_LA_PAGINA =
  "• MÁS DE UNA PÁGINA: casi todo cabe en una con secciones (`#seccion`), y ésa es la " +
  "respuesta por defecto. Escribir un enlace a `/otra` NO crea esa página: si esa ruta " +
  "no existe, el sitio sirve la portada con un 200 y el enlace se rompe EN SILENCIO. " +
  "Enlaza sólo páginas que ya existan.";

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
      "• UN documento `<!doctype html>` completo y autocontenido.",
      "\n",
      RESPUESTA_NO_ES_EL_DOCUMENTO,
    );
  }
  // El bloque ENLACES se lleva dentro la viñeta de las páginas: si la
  // superficie lo retira entero, la frase falsa se va con él y no hay nada que
  // sustituir.
  if (!forma.elEnlaceCreaLaPagina && !quita.includes("enlaces")) {
    out = corta(out, quien, "paginas", "• MÁS DE UNA PÁGINA:", "\n", EL_ENLACE_NO_CREA_LA_PAGINA);
  }
  if (quita.includes("javascript")) {
    // La viñeta ya pasó por `swapJsClauses`, así que la marca es su versión
    // permisiva. Por eso este ajuste va DESPUÉS del intercambio y nunca antes:
    // quitarla primero dejaría al intercambio sin su marca y lanzaría.
    out = corta(out, quien, "javascript", "• JavaScript: tu código SOBREVIVE a la publicación", "\n", "");
  }
  if (quita.includes("data-slot-path")) {
    out = corta(out, quien, "data-slot-path", "• Ningún atributo `data-slot-path=` en ninguna parte.", "\n", "");
  }
  if (quita.includes("enlaces")) {
    out = corta(
      out,
      quien,
      "enlaces",
      "ENLACES\n• Cualquier dirección que traiga el brief",
      "COLOR, FORMA Y TIPOGRAFÍA",
      "",
    );
  }
  return out;
}
