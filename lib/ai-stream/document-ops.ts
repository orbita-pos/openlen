// lib/ai-stream/document-ops.ts — el CSS y el <head> como objetivos de una op.
//
// POR QUÉ. El camino barato de edición (Modo A) direcciona elementos por
// `data-op-id`, y `SKIP_TAGS` deja fuera `head`, `style`, `title`, `link` y
// `meta` (`crates/html-engine/src/ops/tagger.rs:13`). El modelo VE el CSS —el
// documento que se le manda es entero— pero no podía tocarlo, así que
// «cámbiame la tipografía» costaba reescribir la página completa por una línea.
// Y cada reescritura es una oportunidad de perder algo.
//
// MEDIDO el 2026-08-22 sobre las 178 plantillas del repo: sólo 7 leen
// `var(--ol-*)`. En las otras 171 el camino determinista (`cambiar_tema`)
// escribía un token que nadie consume y reportaba éxito. La salida no es
// convertir 171 dialectos de CSS escritos a mano —eso es Canva-mode en
// miniatura— sino que el modelo edite el CSS de verdad, que es lo que haría
// cualquiera con el archivo delante.
//
// EL MISMO PATRÓN QUE `splitRuntimeOps`: objetivos reservados que el aplicador
// de ops nunca llega a ver. `parseOps` devuelve `target` como string libre, así
// que el reparto ocurre AQUÍ, en TypeScript, entre parsear y aplicar — el crate
// de Rust no se toca y la equivalencia byte a byte del shadow soak queda
// intacta. Meter el `<head>` en `SKIP_TAGS` habría renumerado los op-id del
// documento ENTERO, porque son un contador secuencial.

import type { Op } from "@/lib/html-ops";
import { esUrlDeLibreria } from "@/lib/librerias";
import { documentOpsEnabled } from "@/lib/publish/kill-switches";

/** El CSS de la página. */
export const STYLES_OP_TARGET = "styles";
/** El `<head>`, bajo lista blanca estricta (ver `nodoDeCabezaPermitido`). */
export const HEAD_OP_TARGET = "head";

/**
 * El bloque que el modelo posee.
 *
 * Va APARTE del CSS de la plantilla, y no es cosmético: mezclarlos haría que
 * `replace` pudiera llevarse por delante el CSS que el usuario no pidió tocar,
 * y que quitar un kit de temáticas se llevara las reglas del modelo. Además va
 * el ÚLTIMO del `<head>`, así que a igual especificidad sus reglas ganan — que
 * es justo lo que hace falta para pisar el `font-family` de una plantilla.
 */
export const MODEL_CSS_ATTR = "data-ol-model-css";

/** 16 KiB. Un ajuste quirúrgico son unas líneas; si pasa de esto, lo que el
 *  modelo quiere es reescribir la página, y para eso está el Modo B. */
export const MAX_MODEL_CSS_BYTES = 16 * 1024;

export type DocumentOpRejection =
  /** Más de una op contra el mismo objetivo: no se fusionan — no sabríamos en
   *  qué orden. Mismo criterio que `splitRuntimeOps`. */
  | "varias"
  | "op_no_soportada"
  | "vacio"
  | "demasiado_grande"
  | "no_permitido"
  | "marcador_de_editor";

export type StylesOpResult =
  | { readonly kind: "ninguna" }
  | { readonly kind: "css"; readonly css: string; readonly modo: "anadir" | "reemplazar" }
  | { readonly kind: "error"; readonly reason: DocumentOpRejection };

export type HeadOpResult =
  | { readonly kind: "ninguna" }
  | { readonly kind: "nodos"; readonly html: string }
  | { readonly kind: "error"; readonly reason: DocumentOpRejection };

/** Lo único que puede entrar al `<head>` desde una op.
 *
 *  NUNCA `<base>` (reescribe TODOS los enlaces relativos de la página de una
 *  vez) ni `<meta http-equiv>` (un refresco o una CSP propia).
 *
 *  `<script>`: SÓLO con `src` a `libs.openlen.com`, y NUNCA inline. Aquí decía
 *  «NUNCA `<script>`: ese camino es `target="runtime"`, y colarlo por aquí
 *  esquivaría la cápsula y el sellado CSP». Las dos razones murieron el mismo
 *  día, el 2026-08-26: la cápsula (`933acc9d` — el script del modelo vive ahora
 *  dentro de `data.html`) y el sellado CSP (`seal.rs`, retirado por decisión de
 *  Jesús). Y `target="runtime"` nunca cubrió este caso: ése es el script DEL
 *  MODELO —uno, inline, al final del body—, mientras que una librería es una
 *  dependencia EXTERNA que tiene que estar cargada ANTES. Sin esta puerta, Len
 *  no podía añadir Chart.js a una página que no naciera con ella.
 *
 *  Inline sigue prohibido, y eso no es inercia: sería una SEGUNDA vía para
 *  meter código arbitrario, con reglas distintas de las que ya tiene la que
 *  existe. Ver `lib/librerias.ts` para el catálogo y las otras dos listas.
 *
 *  SÍ el `<title>` y la meta description. La primera versión los excluía
 *  razonando que `ensurePageMeta` ya los escribe y dos escritores del mismo
 *  campo es cómo se pierde uno. Dos cosas lo desmintieron: `ensurePageMeta` es
 *  NO DESTRUCTIVO por contrato —sólo añade lo ausente, su propio encabezado lo
 *  dice— y, MEDIDO el 2026-08-22 con los ataques de QA, «cambia el teléfono en
 *  TODA la página» dejaba el número viejo en la meta description 3 de 3 veces.
 *  Un teléfono muerto en el fragmento que enseña Google son llamadas perdidas.
 *
 *  Y la hoja de Google Fonts, que es con lo que empezó esto: sin ella, cambiar
 *  la tipografía deja el `font-family` apuntando a una fuente que el navegador
 *  no tiene y la página cae al serif del sistema. */
function nodoDeCabezaPermitido(fragmento: string): boolean {
  const t = fragmento.trim();
  if (/^<title[\s>]/i.test(t)) return /<\/title\s*>$/i.test(t);
  if (/^<meta[\s>]/i.test(t)) {
    // `http-equiv` fuera: es un refresco, o una CSP propia.
    if (/\shttp-equiv\s*=/i.test(t)) return false;
    return /\sname\s*=\s*["'](description|keywords|author)["']/i.test(t);
  }
  if (/^<script[\s>]/i.test(t)) {
    // Un `<script>` de librería es una etiqueta VACÍA con `src`. Si trae cuerpo
    // es código, y el código tiene su propia puerta (`target="runtime"`).
    if (!/>\s*<\/script\s*>$/i.test(t)) return false;
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(t)?.[1]?.trim() ?? "";
    return esUrlDeLibreria(src);
  }
  if (!t.startsWith("<link")) return false;
  if (/<\s*\//.test(t.slice(5))) return false; // un solo elemento vacío
  const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(t)?.[1]?.trim() ?? "";
  return (
    href.startsWith("https://fonts.googleapis.com/") ||
    href.startsWith("https://fonts.gstatic.com/") ||
    // La hoja de Swiper: sin ella el carrusel se apila en vertical y la página
    // parece rota. Una librería con CSS llega con las DOS etiquetas o ninguna.
    esUrlDeLibreria(href)
  );
}

/** Los que llevan cierre y hay que mantener de una pieza. */
const ETIQUETAS_PAREADAS = /^(?:title|script)$/i;

function separarPorEtiqueta(fragmento: string): string[] {
  // Sin analizador: se parte en elementos de nivel superior para poder validar
  // uno a uno y rechazar la tanda entera si alguno no pasa — aceptar "los que
  // valgan" dejaría al modelo creyendo que puso algo que no está.
  //
  // ANTES ERA `split(/(?<=>)/)`, y eso partía por CUALQUIER `>`. Con nodos
  // vacíos (`<meta>`, `<link>`) daba igual, pero un `<title>Hola</title>` se
  // rompía en `<title>` y `Hola</title>`, y las dos mitades fallaban la
  // validación. O sea: el `<title>` que el encabezado de arriba lleva desde el
  // 2026-08-22 diciendo que se acepta NUNCA pasó por la ruta real — sólo por
  // las pruebas, que llamaban a `applyHeadOp` con los nodos ya montados.
  // Comprobado y arreglado el 2026-08-31, al abrir la misma puerta al
  // `<script>` de una librería, que se rompía igual.
  const out: string[] = [];
  let i = 0;
  while (i < fragmento.length) {
    const abre = fragmento.indexOf("<", i);
    if (abre === -1) break;
    // Texto suelto entre elementos: se conserva como trozo para que el
    // validador lo rechace. Tirarlo en silencio sería aceptar una tanda que el
    // modelo escribió con algo más dentro.
    const hueco = fragmento.slice(i, abre).trim();
    if (hueco.length > 0) out.push(hueco);

    const finApertura = fragmento.indexOf(">", abre);
    if (finApertura === -1) {
      out.push(fragmento.slice(abre).trim());
      i = fragmento.length;
      break;
    }
    let fin = finApertura + 1;
    const nombre = /^<\s*([a-z0-9-]+)/i.exec(fragmento.slice(abre, finApertura + 1))?.[1] ?? "";
    if (ETIQUETAS_PAREADAS.test(nombre)) {
      const bajo = fragmento.toLowerCase();
      const cierre = bajo.indexOf(`</${nombre.toLowerCase()}`, fin);
      const finCierre = cierre === -1 ? -1 : fragmento.indexOf(">", cierre);
      if (finCierre === -1) {
        // Sin cierre: el trozo va entero y el validador lo tumba.
        out.push(fragmento.slice(abre).trim());
        i = fragmento.length;
        break;
      }
      fin = finCierre + 1;
    }
    const trozo = fragmento.slice(abre, fin).trim();
    if (trozo.length > 0) out.push(trozo);
    i = fin;
  }
  const cola = fragmento.slice(i).trim();
  if (cola.length > 0) out.push(cola);
  return out;
}

function payloadDe(op: Op): string {
  return (op.newHtml ?? "").trim();
}

function unaSola(
  ops: readonly Op[],
  target: string,
): { op: Op | null; error: DocumentOpRejection | null } {
  const mias = ops.filter((o) => o.target === target);
  if (mias.length === 0) return { op: null, error: null };
  if (mias.length > 1) return { op: null, error: "varias" };
  return { op: mias[0]!, error: null };
}

function leerStyles(op: Op): StylesOpResult {
  // `insert_before` / `insert_after` son lo mismo aquí: AÑADIR reglas al final
  // del bloque del modelo. La cascada hace el resto. No se distinguen porque
  // "antes del CSS" no significa nada útil y fingir que sí sería una trampa.
  const modo =
    op.type === "replace"
      ? "reemplazar"
      : op.type === "insert_after" || op.type === "insert_before"
        ? "anadir"
        : null;
  if (modo === null) return { kind: "error", reason: "op_no_soportada" };

  let css = payloadDe(op);
  // Tolerar el `<style>` entero, igual que `runtimeCodeFromOpPayload` tolera el
  // `<script>`: toda op de `replace` lleva un elemento, así que es lo natural
  // que emita. Sin expresión regular con `\b` — ver la trampa anotada en
  // model-runtime.ts (dentro de un template literal es el carácter de retroceso).
  if (css.startsWith("<style") || css.startsWith("<STYLE")) {
    const abre = css.indexOf(">");
    const cierra = css.toLowerCase().lastIndexOf("</style>");
    if (abre !== -1 && cierra > abre) css = css.slice(abre + 1, cierra).trim();
  }

  if (css.length === 0) return { kind: "error", reason: "vacio" };
  if (Buffer.byteLength(css, "utf8") > MAX_MODEL_CSS_BYTES) {
    return { kind: "error", reason: "demasiado_grande" };
  }
  // Invariante del repo: el marcador reservado del editor no llega al disco ni
  // a la base por ningún camino.
  if (css.includes("data-slot-path=")) return { kind: "error", reason: "marcador_de_editor" };
  // Un `</style>` dentro del CSS cerraría el bloque antes de tiempo y el resto
  // se pintaría como texto. Y `<script` dentro de un `<style>` no es CSS: es
  // alguien buscando la salida.
  if (/<\s*\/?\s*(style|script)\b/i.test(css)) return { kind: "error", reason: "no_permitido" };

  return { kind: "css", css, modo };
}

function leerHead(op: Op): HeadOpResult {
  // Sólo añadir. `replace` sobre el `<head>` entero se llevaría la CSP, los
  // metadatos y las fuentes de una vez; `delete`, lo mismo sin aviso.
  if (op.type !== "insert_after" && op.type !== "insert_before") {
    return { kind: "error", reason: "op_no_soportada" };
  }
  const html = payloadDe(op);
  if (html.length === 0) return { kind: "error", reason: "vacio" };
  if (html.includes("data-slot-path=")) return { kind: "error", reason: "marcador_de_editor" };

  const nodos = separarPorEtiqueta(html);
  if (nodos.length === 0 || nodos.length > 4) return { kind: "error", reason: "no_permitido" };
  if (!nodos.every(nodoDeCabezaPermitido)) return { kind: "error", reason: "no_permitido" };
  return { kind: "nodos", html: nodos.join("") };
}

/**
 * Aparta las ops de CSS y de `<head>` antes de que el aplicador vea la tanda.
 *
 * Devuelve SIEMPRE `domOps` sin ellas, incluso cuando fallan: el resto del
 * cambio del usuario no tiene por qué caerse porque el CSS venga mal. Quien
 * llame decide qué hacer con el error — la doctrina dice avisar, no tragárselo.
 */
/**
 * EL CONTRATO DE LOS OBJETIVOS RESERVADOS, EN UN SOLO SITIO.
 *
 * Estaba escrito CUATRO veces —el prompt estático del Chat, el bloque dinámico
 * de la ruta, este parser y el catálogo de Len— y las cuatro decían cosas
 * distintas. El coste no era estético: dos de estos objetivos se construyeron
 * para arreglar fallos MEDIDOS (el teléfono viejo en la meta description, 3 de
 * 3; y `lang="es"` al traducir, 3 de 3) y el Chat no sabía que existían, así
 * que en esa superficie los dos fallos seguían pasando igual.
 *
 * Vive aquí, junto al parser que los implementa, para que añadir un objetivo
 * quinto obligue a tocar el mismo fichero que lo enseña. La prueba de paridad
 * (document-ops.test) exige que cada objetivo de esta lista aparezca TAMBIÉN en
 * el catálogo del Agente.
 */
export const RESERVED_TARGETS = [
  STYLES_OP_TARGET,
  HEAD_OP_TARGET,
  "runtime",
  // `LANG_OP_TARGET` se declara más abajo, junto a su parser: se pone el
  // literal para no reordenar el fichero, y la prueba de paridad comprueba que
  // los dos siguen diciendo lo mismo.
  "idioma",
] as const;

/** El bloque que ve el modelo del Chat. El Agente dice lo mismo en su catálogo
 *  (`lib/agent/catalog.ts`), en su propio sobre JSON. */
export function reservedTargetsBlock(): string {
  return `FOUR RESERVED TARGETS that are NOT data-op-id values. \`<html>\`, \`<head>\`, \`<style>\` and \`<script>\` carry no id, so ops cannot address them the normal way — these four reach them WITHOUT a full rewrite, and they do NOT count against the op cap:
  · \`<edit target="styles" op="insert_after">\` — appends CSS rules to YOUR OWN style block, which sits last in <head>, so at equal specificity your rules win over the template's. This is how you change typography, colour or spacing on a page whose CSS does not use \`var(--ol-*)\` tokens. Use \`op="replace"\` to rewrite only what you previously added; the template's own CSS is never touched.
  · \`<edit target="head" op="insert_after">\` — the head nodes you are allowed to write: a Google Fonts stylesheet \`<link>\` (naming a font in CSS does NOT load it — without this link the browser falls back to a generic serif), the \`<title>\`, and \`<meta name="description">\` / \`"keywords"\` / \`"author"\`. A \`<title>\` or \`<meta>\` REPLACES the existing one; it never duplicates. **Whenever you change a fact that also appears in the meta description — a phone number, an address, an opening time — change it there too in the same turn.** That snippet is what Google shows: a dead phone number there is lost calls. Nothing outside this list may be added.
  · \`<edit target="idioma" op="replace">\` — the document language, with just the code inside (\`en\`, \`pt-BR\`). \`<html lang>\` is not addressable any other way. **When you TRANSLATE a page this is mandatory.** Leaving the old lang makes a screen reader read English with Spanish phonetics — unusable for anyone who depends on it — and that attribute feeds the site's hreflang when it is published, so the mistake spreads to search.
  · \`<edit target="runtime" op="replace">\` — the page's JavaScript, as described below. \`op="delete"\` on this target removes it.
A one-line CSS change is an \`edit\`, never a reason to rewrite the whole document. Rewriting is Mode B and every rewrite is a chance to lose something the user never asked you to touch.`;
}

export function splitDocumentOps(
  ops: readonly Op[],
  env: Record<string, string | undefined> = process.env,
): {
  domOps: Op[];
  styles: StylesOpResult;
  head: HeadOpResult;
} {
  // Apagado ⇒ nada se aparta y todo cae al aplicador, que rechaza un target
  // inexistente igual que antes de que esto existiera. Es el brazo de control
  // de la medición, y la palanca de vuelta atrás si en producción sale mal.
  if (!documentOpsEnabled(env)) {
    return { domOps: [...ops], styles: { kind: "ninguna" }, head: { kind: "ninguna" } };
  }
  const domOps = ops.filter(
    (o) => o.target !== STYLES_OP_TARGET && o.target !== HEAD_OP_TARGET,
  );

  const s = unaSola(ops, STYLES_OP_TARGET);
  const h = unaSola(ops, HEAD_OP_TARGET);

  return {
    domOps,
    styles: s.error
      ? { kind: "error", reason: s.error }
      : s.op
        ? leerStyles(s.op)
        : { kind: "ninguna" },
    head: h.error
      ? { kind: "error", reason: h.error }
      : h.op
        ? leerHead(h.op)
        : { kind: "ninguna" },
  };
}

function insertarEnCabeza(html: string, fragmento: string): string {
  const i = html.toLowerCase().lastIndexOf("</head>");
  if (i !== -1) return html.slice(0, i) + fragmento + html.slice(i);
  // Sin `</head>` — un documento que ya pasó por el normalizador no debería
  // estar así. Perderlo en silencio sería peor que ponerlo donde el navegador
  // lo lee igual.
  const b = html.toLowerCase().indexOf("<body");
  if (b !== -1) return html.slice(0, b) + fragmento + html.slice(b);
  return fragmento + html;
}

const BLOQUE_RE = new RegExp(`<style[^>]*\\s${MODEL_CSS_ATTR}[^>]*>([\\s\\S]*?)</style>`, "i");

/** El CSS que el modelo ya había puesto, o "" si no hay bloque suyo todavía. */
export function readModelCss(html: string): string {
  return BLOQUE_RE.exec(html)?.[1]?.trim() ?? "";
}

/** Escribe el bloque del modelo. Añadir concatena; reemplazar pisa SÓLO su
 *  bloque, nunca el CSS de la plantilla. */
export function applyStylesOp(html: string, result: StylesOpResult): string {
  if (result.kind !== "css") return html;
  const previo = readModelCss(html);
  const siguiente =
    result.modo === "anadir" && previo.length > 0 ? `${previo}\n${result.css}` : result.css;
  const bloque = `<style ${MODEL_CSS_ATTR}>${siguiente}</style>`;
  return BLOQUE_RE.test(html) ? html.replace(BLOQUE_RE, bloque) : insertarEnCabeza(html, bloque);
}

/**
 * Pone los nodos en el `<head>`.
 *
 * Un `<title>` o una `<meta name="…">` REEMPLAZAN al que ya hubiera: dos
 * títulos o dos descripciones no son un añadido, son un documento roto del que
 * el navegador elige uno y nadie sabe cuál. Lo demás se añade, sin duplicar.
 */
export function applyHeadOp(html: string, result: HeadOpResult): string {
  if (result.kind !== "nodos") return html;
  let out = html;
  const aAñadir: string[] = [];

  for (const nodo of separarPorEtiqueta(result.html)) {
    if (/^<title[\s>]/i.test(nodo)) {
      out = /<title[^>]*>[\s\S]*?<\/title\s*>/i.test(out)
        ? out.replace(/<title[^>]*>[\s\S]*?<\/title\s*>/i, nodo)
        : ((aAñadir.push(nodo), out));
      continue;
    }
    const meta = /^<meta[^>]*\sname\s*=\s*["']([\w-]+)["']/i.exec(nodo);
    if (meta) {
      const re = new RegExp(`<meta[^>]*\\sname\\s*=\\s*["']${meta[1]}["'][^>]*>`, "i");
      out = re.test(out) ? out.replace(re, nodo) : ((aAñadir.push(nodo), out));
      continue;
    }
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(nodo)?.[1];
    // Repetir la hoja de fuentes no rompe la página, pero la hace pesar dos
    // veces y el horneado de fuentes al publicar tiene que resolverla dos
    // veces. Un turno que pide lo que ya está no cambia nada.
    if (!href || !out.includes(href)) aAñadir.push(nodo);
  }
  return aAñadir.length === 0 ? out : insertarEnCabeza(out, aAñadir.join(""));
}

/** El idioma del documento — `lang` en `<html>`. */
export const LANG_OP_TARGET = "idioma";

/** Códigos BCP-47 sencillos: `en`, `es`, `pt-BR`. Nada más entra a un atributo
 *  que el navegador y los lectores de pantalla obedecen. */
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export type LangOpResult =
  | { readonly kind: "ninguna" }
  | { readonly kind: "idioma"; readonly lang: string }
  | { readonly kind: "error"; readonly reason: DocumentOpRejection };

/**
 * EL IDIOMA DEL DOCUMENTO, que tampoco era alcanzable.
 *
 * `<html>` está en `SKIP_TAGS`, así que no lleva `data-op-id` y su `lang` no se
 * podía tocar por el camino barato. MEDIDO el 2026-08-22 con los ataques de QA:
 * «pon la página en inglés» tradujo el cuerpo correctamente y dejó `lang="es"`
 * 3 de 3 veces.
 *
 * No es cosmético por dos razones: un lector de pantalla lee inglés con voz y
 * fonética españolas —ilegible para quien depende de él— y `detectHtmlLang`
 * alimenta el `hreflang` del clúster multilingüe al publicar, así que el error
 * se propaga al SEO.
 *
 * Objetivo propio y no parte de `head` porque no es un nodo de la cabecera: es
 * un atributo de la raíz. Meterlo ahí sería mentir sobre lo que hace.
 */
export function splitLangOp(ops: readonly Op[]): { domOps: Op[]; lang: LangOpResult } {
  const domOps = ops.filter((o) => o.target !== LANG_OP_TARGET);
  if (!documentOpsEnabled()) return { domOps: [...ops], lang: { kind: "ninguna" } };
  const mias = ops.filter((o) => o.target === LANG_OP_TARGET);
  if (mias.length === 0) return { domOps, lang: { kind: "ninguna" } };
  if (mias.length > 1) return { domOps, lang: { kind: "error", reason: "varias" } };
  const op = mias[0]!;
  if (op.type !== "replace") return { domOps, lang: { kind: "error", reason: "op_no_soportada" } };
  // Se tolera el código pelado (`en`) y el atributo entero (`lang="en"`), igual
  // que `styles` tolera el `<style>` entero: toda op de replace lleva algo, y
  // perder un cambio bueno por el envoltorio no sale a cuenta.
  const bruto = (op.newHtml ?? "").trim();
  const code = (/lang\s*=\s*["']?([\w-]+)/i.exec(bruto)?.[1] ?? bruto).trim();
  if (!code) return { domOps, lang: { kind: "error", reason: "vacio" } };
  if (!LANG_RE.test(code)) return { domOps, lang: { kind: "error", reason: "no_permitido" } };
  return { domOps, lang: { kind: "idioma", lang: code } };
}

const HTML_TAG_RE = /<html\b[^>]*>/i;

/** Escribe `lang` en `<html>`, reemplazando el que hubiera. */
export function applyLangOp(html: string, result: LangOpResult): string {
  if (result.kind !== "idioma") return html;
  const m = HTML_TAG_RE.exec(html);
  if (!m) return html;
  const tag = /\slang\s*=\s*["'][^"']*["']/i.test(m[0])
    ? m[0].replace(/\slang\s*=\s*["'][^"']*["']/i, ` lang="${result.lang}"`)
    : m[0].replace(/^<html\b/i, `<html lang="${result.lang}"`);
  return html.slice(0, m.index) + tag + html.slice(m.index + m[0].length);
}

/** Frase para el USUARIO cuando el cambio de estilo se descartó. En español:
 *  la ve él, no el modelo. */
export function documentOpAviso(
  target: "styles" | "head" | "idioma",
  reason: DocumentOpRejection,
): string {
  const porque: Record<DocumentOpRejection, string> = {
    varias: "mandó dos versiones y no se puede saber cuál quería",
    op_no_soportada:
      target === "head"
        ? "intentó reemplazar o borrar la cabecera entera, y sólo se puede añadir"
        : target === "idioma"
          ? "usó una operación que no es reemplazar"
          : "usó una operación que no aplica sobre una hoja de estilos",
    vacio: "mandó el bloque vacío",
    demasiado_grande: `el CSS pasa de ${Math.floor(MAX_MODEL_CSS_BYTES / 1024)} KiB`,
    no_permitido:
      target === "head"
        ? "intentó meter algo que no entra en la cabecera (sólo la hoja de fuentes, el <title> y las <meta> de description, keywords o author)"
        : target === "idioma"
          ? "el código de idioma no es válido (se espera algo como `en` o `pt-BR`)"
          : "el CSS traía etiquetas dentro",
    marcador_de_editor: "traía un marcador reservado del editor",
  };
  const que =
    target === "head"
      ? "el cambio en la cabecera"
      : target === "idioma"
        ? "el cambio de idioma"
        : "el cambio de estilo";
  return `No pude aplicar ${que}: ${porque[reason]}. El resto de la edición sí se guardó.`;
}
