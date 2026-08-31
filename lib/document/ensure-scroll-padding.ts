import { parse } from "node-html-parser";

/**
 * Que un ancla no aterrice DEBAJO de la barra fija.
 *
 * 🔴 EL FALLO, MEDIDO el 2026-08-30 sobre las 60 páginas más recientes: de las
 * 39 que llevan algo pegado arriba, **35 (el 90%)** tienen anclas cuyo destino
 * no reserva sitio para ello. El usuario pulsa «¿Cómo funciona?» o «Precios»,
 * la página salta, y el TÍTULO de la sección queda tapado por la barra: se ve
 * el contenido empezado a media altura, sin encabezado, y parece roto. Lo
 * reportó Jesús probando, y llevaba tiempo pasando.
 *
 * Y la causa raíz no es que el modelo lo ignore: NINGUNO de los cuatro prompts
 * —contrato mínimo, guía de diseño, prompt de crear, catálogo del Agente—
 * menciona `scroll-mt`, `scroll-padding` ni `scroll-margin`. Cero apariciones.
 * Cuando el modelo acierta, acierta por su cuenta.
 *
 * POR QUÉ VA EN EL MECANISMO Y NO EN EL PROMPT. Es la lección del mismo día,
 * aprendida dos veces: tres reglas del prompt escritas en mayúsculas no
 * dispararon, y mejorar el TEXTO de un rechazo lo dejó peor que antes. Una
 * regla más no arregla un 90%.
 *
 * `scroll-padding-top` en la raíz y no `scroll-margin-top` en cada destino: es
 * UNA regla que cubre todas las anclas de la página, las de hoy y las que el
 * modelo añada mañana. La otra forma —la de shadcn, `class="scroll-mt-24"` en
 * cada sección— funciona, pero hay que acordarse cada vez, y es justo ahí donde
 * falla el 90%.
 *
 * EL VALOR ESTÁ MEDIDO, no elegido: 11 barras reales renderizadas en Chromium
 * miden entre 65 y 75px (mediana 65). 6rem = 96px deja 21px de aire sobre la
 * más alta, y es además lo que el propio modelo escribió (`scroll-mt-24`) en la
 * única página del corpus que lo hizo bien. Se sobrepasa a propósito porque los
 * dos fallos no son simétricos: quedarse corto es el bug que esto arregla;
 * pasarse es aire encima de un titular, que se lee como intencional.
 *
 * Con `var(--ol-scroll-pad, 6rem)` una página con una barra de dos filas puede
 * corregirlo declarando la variable, sin que haya que tocar esto.
 */
const REGLA = "html{scroll-padding-top:var(--ol-scroll-pad,6rem)}";
const MARCA = "data-openlen-scroll-pad";

/** Pegado arriba: Tailwind (`sticky top-0`, `fixed top-0`) o CSS a mano. Se
 *  mira la CLASE y el estilo en línea, no el CSS calculado — esto corre sin
 *  navegador, en la tubería. Un falso negativo sólo deja la página como está. */
const BARRA_FIJA =
  /class="[^"]*\b(?:sticky|fixed)\b[^"]*\btop-0\b|style="[^"]*position:\s*(?:sticky|fixed)[^"]*top:\s*0/i;

/** ¿Alguien ya reservó el sitio? Vale tanto la regla global como que el
 *  documento use `scroll-mt-*` en sus secciones: si el modelo ya se acordó, no
 *  se le pisa. */
const YA_RESERVADO = /scroll-padding-top|scroll-padding\s*:|scroll-mt-|scroll-margin-top/i;

export function ensureScrollPadding(html: string): { html: string; changed: boolean } {
  // Sin anclas no hay a dónde saltar, y sin barra no hay nada que tape.
  if (!/href="#[\w-]/.test(html)) return { html, changed: false };
  if (!BARRA_FIJA.test(html)) return { html, changed: false };
  if (YA_RESERVADO.test(html)) return { html, changed: false };

  const doc = parse(html);
  const head = doc.querySelector("head");
  // Sin `<head>` el documento no pasó por el normalizador. No se inventa uno:
  // esto es una mejora, nunca un peaje.
  if (!head) return { html, changed: false };

  // AL FINAL del head, para ganar por orden a cualquier hoja anterior sin
  // subirle la especificidad ni usar `!important`.
  head.insertAdjacentHTML("beforeend", `<style ${MARCA}>${REGLA}</style>`);
  return { html: doc.toString(), changed: true };
}
