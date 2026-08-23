// Reglas de CSS que NUNCA pueden aplicar — el defecto que ningún navegador
// reporta y ninguna captura enseña.
//
// EL CASO QUE LO MOTIVA, medido el 2026-08-23 en una página real de Jesús:
//
//   .timer-ring .progress-ring { stroke: var(--accent); fill: none; }
//   <div class="relative w-56 h-56 mx-auto my-8">   ← sin `timer-ring`
//
// El modelo escribió LAS DOS MITADES y no las conectó. Sin `fill:none`, un
// `<circle>` de SVG se rellena de NEGRO por defecto, así que el reloj quedó
// ilegible sobre un disco macizo. Cero errores de consola, captura perfecta, y
// el medidor de contraste diciendo que todo estaba bien — porque lo que tapaba
// el texto era un hermano, no un ancestro.
//
// LA SEÑAL, y por qué es de alta precisión: no se avisa de "CSS muerto" a secas
// —un modelo puede escribir una clase que al final no usó, y eso es inofensivo—
// sino del selector donde UNA PARTE existe en el documento y OTRA no. Eso sólo
// pasa cuando el autor PRETENDÍA que la regla aplicara. `.timer-ring .track-ring`
// con `.track-ring` presente y `.timer-ring` ausente es una intención rota, no
// una sobra.
//
// Determinista y sin navegador: microsegundos, así que corre SIEMPRE — también
// en el turno del Agente, que no puede pagar un arranque de Chrome.

export interface ReglaMuerta {
  /** El selector tal cual lo escribió el modelo. */
  readonly selector: string;
  /** Las clases que el documento NO tiene. */
  readonly ausentes: readonly string[];
  /** Las que sí — la prueba de que la regla se pretendía viva. */
  readonly presentes: readonly string[];
}

const MAX_REGLAS = 5;

/** Fuera comentarios: un `/* … *​/` puede contener llaves y romper el escaneo. */
function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Los selectores de una hoja, sin parsear CSS de verdad.
 *
 * Se camina carácter a carácter llevando la profundidad de llaves, en vez de
 * usar una expresión regular: dentro de un `@media` hay llaves anidadas y
 * cualquier regex de `([^{}]+)\{` las trocea mal.
 */
function selectores(css: string): string[] {
  const fuera: string[] = [];
  let buf = "";
  let prof = 0;
  for (const ch of sinComentarios(css)) {
    if (ch === "{") {
      const sel = buf.trim();
      // Las at-rules (`@media`, `@supports`, `@keyframes`) no son selectores.
      // Su CONTENIDO sí, y lo recoge la siguiente vuelta porque `prof` sube.
      if (sel && !sel.startsWith("@")) fuera.push(sel);
      buf = "";
      prof += 1;
    } else if (ch === "}") {
      buf = "";
      if (prof > 0) prof -= 1;
    } else if (ch === ";") {
      // Una declaración dentro de un bloque: no arrastrarla al siguiente
      // selector (`color:red; .foo` daría "color:red .foo").
      buf = "";
    } else {
      buf += ch;
    }
  }
  return fuera;
}

/** Las clases que nombra un selector. `.a .b:hover` → ["a", "b"]. */
function clasesDe(selector: string): string[] {
  return [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/** Las clases que el documento REALMENTE lleva en su markup. */
function clasesDelMarkup(html: string): Set<string> {
  const set = new Set<string>();
  for (const m of html.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const c of (m[2] ?? m[3] ?? "").split(/\s+/)) if (c) set.add(c);
  }
  return set;
}

/**
 * Las hojas PROPIAS del documento.
 *
 * Se saltan los bloques que llevan un atributo `data-ol-*`: son los carriers de
 * tema que inyecta OpenLen (`data-ol-color`, `data-ol-radius`…), declaran
 * clases de estado a propósito y no los escribió el modelo. Avisar de ellos
 * sería acusar a la casa.
 */
function hojasPropias(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)) {
    if (/\sdata-ol-[\w-]+/i.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

/**
 * Los selectores que no pueden aplicar nunca sobre ESTE documento.
 *
 * `runtime` es el JavaScript del modelo, si lo hay: una clase que el script
 * añade en caliente (`classList.add("activo")`) está AUSENTE del markup inicial
 * y es correcta. Sin mirarlo, todo estado dinámico saldría como falso positivo.
 */
export function reglasQueNuncaAplican(
  html: string,
  runtime?: string | null,
): ReglaMuerta[] {
  const enMarkup = clasesDelMarkup(html);
  const js = runtime ?? "";
  const vistos = new Set<string>();
  const out: ReglaMuerta[] = [];

  for (const hoja of hojasPropias(html)) {
    for (const sel of selectores(hoja)) {
      // Una lista `a, b, c` son selectores independientes: se juzgan por
      // separado o un miembro sano taparía a uno roto.
      for (const parte of sel.split(",")) {
        const clases = [...new Set(clasesDe(parte))];
        if (clases.length === 0) continue;
        const ausentes = clases.filter((c) => !enMarkup.has(c) && !js.includes(c));
        const presentes = clases.filter((c) => enMarkup.has(c));
        // LA REGLA DE PRECISIÓN: sólo cuenta si algo del selector SÍ existe.
        // Un `.foo` suelto que no está en ninguna parte es CSS de sobra, no una
        // promesa rota, y avisar de eso enseñaría a ignorar los avisos.
        if (ausentes.length === 0 || presentes.length === 0) continue;
        const clave = parte.trim();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        out.push({ selector: clave, ausentes, presentes });
        if (out.length >= MAX_REGLAS) return out;
      }
    }
  }
  return out;
}

/** El aviso, en el idioma en que el modelo tiene que actuar. */
export function avisoReglasMuertas(reglas: readonly ReglaMuerta[]): string {
  if (reglas.length === 0) return "";
  const lista = reglas
    .map(
      (r) =>
        `\`${r.selector}\` — falta \`class="${r.ausentes[0]}"\` en el documento ` +
        `(\`${r.presentes[0]}\` sí está)`,
    )
    .join("; ");
  return (
    `Escribiste CSS que NUNCA se aplica: ${lista}. ` +
    `El estilo existe y el elemento existe, pero no se tocan, así que el control ` +
    `sale con el aspecto por defecto del navegador — y en un <circle> de SVG sin ` +
    `\`fill\` ese defecto es NEGRO MACIZO. Añade la clase que falta al elemento, ` +
    `o cambia el selector por uno que sí case.`
  );
}
