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

// ── LAS DOS MITADES: la clase que el script pone y que nada usa ──────────────
//
// El espejo de `reglasQueNuncaAplican`. Aquélla caza el estilo que no encuentra
// su elemento; esto caza el estado que no encuentra su estilo:
//
//   menu.classList.toggle("open")      ← y ninguna regla dice qué es `.open`
//
// El script corre, no lanza, no sale nada en consola, y en pantalla no cambia
// nada: el control está mudo. Es el segundo punto ciego medido del JavaScript
// del modelo (ver `DOS_MITADES_EN` en `lib/ai/js-clause.ts`), que hasta hoy
// sólo se le pedía en el prompt.
//
// LA PRECISIÓN, con la misma vara que su hermano. No se avisa de «clase sin
// CSS» a secas: una clase puede ser una marca que el propio script lee después
// (`contains("open")`, `querySelector(".open")`). Sólo se afirma cuando NADA la
// usa, y eso son tres comprobaciones DEFINIDAS, sin juicio:
//   · ninguna regla de ningún `<style>` de la página la nombra;
//   · el script no la lee (ni `contains`/`getElementsByClassName`, ni un
//     selector `.clase` en ninguna de sus cadenas, que es también donde vive el
//     CSS que un script inyecta);
//   · Tailwind, si la página lo carga, no genera nada para ella — lo contesta su
//     compilador (`clases-de-tailwind.ts`), inyectado aquí para que esto siga
//     siendo puro.
// Con las tres, poner esa clase es no hacer nada. Es un hecho, no una opinión.
//
// Y si la página carga una hoja que no podemos leer (la de Swiper, por
// ejemplo), no se afirma NADA en esa página: esa hoja podría definirla.

export interface ClaseSinEstilo {
  /** La clase que el script pone. */
  readonly clase: string;
  /** Dónde se pone, en el documento: ancla el diagnóstico. */
  readonly indice: number;
}

/** Contesta qué clases de la lista genera Tailwind con la configuración de la página. */
export type ConoceTailwind = (clases: readonly string[]) => ReadonlySet<string>;

const MAX_CLASES_SIN_ESTILO = 5;

/** Los trozos del documento que son JavaScript, con dónde empiezan. */
function trozosDeScript(html: string): { texto: string; desde: number }[] {
  const out: { texto: string; desde: number }[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    // Infraestructura nuestra (`src`, carriers `data-ol-*`) y bloques de datos:
    // no es el código del modelo. Igual que `todoElJsDelDocumento`.
    if (/\bsrc\s*=/i.test(attrs) || /\bdata-ol-/i.test(attrs)) continue;
    if (/\btype\s*=\s*["']?(?:application\/(?:ld\+)?json|text\/template)/i.test(attrs)) continue;
    out.push({ texto: m[2], desde: (m.index ?? 0) + m[0].indexOf(">") + 1 });
  }
  // Los `on*` del marcado también son script, y Len ya los puede escribir.
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const texto = m[1] ?? m[2] ?? "";
    out.push({ texto, desde: (m.index ?? 0) + m[0].length - texto.length - 1 });
  }
  return out;
}

/** Las cadenas literales de un trozo de JS, con su posición dentro del trozo. */
function cadenas(js: string): { valor: string; en: number }[] {
  const out: { valor: string; en: number }[] = [];
  for (const m of js.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^`\\])*)`/g)) {
    out.push({ valor: m[2] ?? m[3] ?? "", en: (m.index ?? 0) + 1 });
  }
  return out;
}

/** Los argumentos de una llamada, a partir del paréntesis que la abre. */
function argumentos(js: string, abre: number): string[] {
  const args: string[] = [];
  let prof = 0;
  let comilla = "";
  let buf = "";
  for (let i = abre + 1; i < js.length; i++) {
    const ch = js[i];
    if (comilla) {
      buf += ch;
      if (ch === "\\") buf += js[++i] ?? "";
      else if (ch === comilla) comilla = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") comilla = ch;
    else if (ch === "(" || ch === "[" || ch === "{") prof++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (prof === 0) break;
      prof--;
    } else if (ch === "," && prof === 0) {
      args.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  args.push(buf);
  return args;
}

/**
 * Las clases de una expresión: las de sus cadenas literales, partidas por
 * espacios. Lo que se construye en tiempo de ejecución (`"is-" + x`,
 * `` `is-${x}` ``) no se puede afirmar y se deja fuera.
 */
function clasesDeExpresion(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const valor = m[2];
    if (valor.includes("${")) continue;
    // Pegada a una concatenación, la cadena es un trozo de un nombre. Al lado
    // de una comparación es un VALOR que se compara (`tipo === "error" ?
    // "is-error" : …`), no una clase. Y dentro de una llamada es su argumento
    // (`lista.includes("x") ? …`). Medido en la pasada del 2026-09-29: los
    // dos primeros falsos avisos eran justo `kind === "error"` y `=== "ok"`.
    const antes = expr.slice(0, m.index).trimEnd();
    const despues = expr.slice((m.index ?? 0) + m[0].length).trimStart();
    if (antes.endsWith("+") || despues.startsWith("+")) continue;
    if (/[=!<>]=?$/.test(antes) || /^[=!<>]/.test(despues)) continue;
    if (/[\w$\])]\s*\($/.test(antes)) continue;
    for (const c of valor.split(/\s+/)) if (/^[!-]?[A-Za-z_][\w:/.[\]#%!-]*$/.test(c)) out.push(c);
  }
  return out;
}

/** Cada clase que el script pone, con dónde la pone. */
function clasesQuePoneElScript(trozos: readonly { texto: string; desde: number }[]): { clase: string; indice: number }[] {
  const out: { clase: string; indice: number }[] = [];
  for (const { texto, desde } of trozos) {
    for (const m of texto.matchAll(/\.classList\s*\.\s*(add|toggle|replace)\s*\(/g)) {
      const args = argumentos(texto, (m.index ?? 0) + m[0].length - 1);
      // toggle: sólo el primero (el segundo es la condición); replace: la
      // nueva, que es la segunda; add: todas.
      const quePone = m[1] === "toggle" ? args.slice(0, 1) : m[1] === "replace" ? args.slice(1, 2) : args;
      for (const c of quePone.flatMap(clasesDeExpresion)) out.push({ clase: c, indice: desde + (m.index ?? 0) });
    }
    for (const m of texto.matchAll(/\.className\s*\+?=(?!=)\s*/g)) {
      const resto = texto.slice((m.index ?? 0) + m[0].length);
      const fin = resto.search(/[;\n]/);
      for (const c of clasesDeExpresion(fin === -1 ? resto : resto.slice(0, fin))) {
        out.push({ clase: c, indice: desde + (m.index ?? 0) });
      }
    }
    for (const m of texto.matchAll(/\.setAttribute\s*\(\s*(["'])class\1\s*,/g)) {
      const args = argumentos(texto, texto.indexOf("(", m.index ?? 0));
      for (const c of clasesDeExpresion(args[1] ?? "")) out.push({ clase: c, indice: desde + (m.index ?? 0) });
    }
    for (const m of texto.matchAll(/\.(?:addClass|toggleClass)\s*\(/g)) {
      const args = argumentos(texto, (m.index ?? 0) + m[0].length - 1);
      for (const c of clasesDeExpresion(args[0] ?? "")) out.push({ clase: c, indice: desde + (m.index ?? 0) });
    }
  }
  return out;
}

const escapa = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿El propio script lee esa clase? Entonces es una marca de estado, no un estilo. */
function laLeeElScript(clase: string, js: string, literales: readonly string[]): boolean {
  const c = escapa(clase);
  if (new RegExp(`(?:contains|getElementsByClassName|hasClass|includes|indexOf)\\s*\\(\\s*(["'\`])${c}\\1`).test(js)) {
    return true;
  }
  const comoSelector = new RegExp(`(?:^|[^\\w-])\\.${c}(?![\\w-])`);
  return literales.some((l) => comoSelector.test(l));
}

/** ¿Carga la página una hoja que no podemos leer? */
function cargaHojaIlegible(html: string): boolean {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(m[0])?.[1] ?? "";
    if (!/^https:\/\/fonts\.googleapis\.com\//i.test(href)) return true;
  }
  // Un `@import` dentro del CSS de la página trae otra hoja igual de ilegible.
  return /<style\b[^>]*>[^<]*@import\b/i.test(html);
}

/** ¿Carga la página Tailwind? El CDN en el lienzo, o su CSS ya horneado. */
function cargaTailwind(html: string): boolean {
  return /<script\b[^>]*\bsrc\s*=\s*["']?https?:\/\/(?:cdn|play)\.tailwindcss\.com/i.test(html) || /<style\b[^>]*\bdata-tw-baked/i.test(html);
}

/**
 * Las clases que el script pone y que nada usa en ESTE documento.
 *
 * `conoceTailwind` sólo se llama si la página carga Tailwind y queda alguna
 * clase sin dueño en el CSS y en el script. Si lanza, no se afirma nada: un
 * diagnóstico que no sabe contestar calla.
 */
export function clasesQueElScriptPoneSinEstilo(
  html: string,
  conoceTailwind: ConoceTailwind,
): ClaseSinEstilo[] {
  const trozos = trozosDeScript(html);
  const puestas = clasesQuePoneElScript(trozos);
  if (puestas.length === 0 || cargaHojaIlegible(html)) return [];

  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => sinComentarios(m[1])).join("\n");
  const enElCss = new Set(selectores(css).flatMap(clasesDe));
  // `[class~="open"]`, `[class*="open"]`: también la nombran.
  const atributos = [...css.matchAll(/\[class[^\]]*\]/gi)].map((m) => m[0]).join(" ");
  const js = trozos.map((t) => t.texto).join("\n");
  const literales = trozos.flatMap((t) => cadenas(t.texto).map((c) => c.valor));

  const primeras = new Map<string, number>();
  for (const p of puestas) if (!primeras.has(p.clase)) primeras.set(p.clase, p.indice);
  const sinDueno = [...primeras.keys()].filter(
    (c) => !enElCss.has(c) && !atributos.includes(c) && !laLeeElScript(c, js, literales),
  );
  if (sinDueno.length === 0) return [];

  let deTailwind: ReadonlySet<string> = new Set();
  if (cargaTailwind(html)) {
    try {
      deTailwind = conoceTailwind(sinDueno);
    } catch {
      return [];
    }
  }
  return sinDueno
    .filter((c) => !deTailwind.has(c))
    .slice(0, MAX_CLASES_SIN_ESTILO)
    .map((clase) => {
      // Se ancla en la propia clase, dentro de la llamada que la pone: es lo
      // primero que aparece con ese nombre a partir de la llamada.
      const llamada = primeras.get(clase) ?? 0;
      const i = html.indexOf(clase, llamada);
      return { clase, indice: i === -1 ? llamada : i };
    });
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
