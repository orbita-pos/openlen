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
 *  NUNCA `<script>`: ese camino es `target="runtime"`, y colarlo por aquí
 *  esquivaría la cápsula y el sellado CSP — el script viajaría sin política y
 *  sin quedar atado al documento. NUNCA `<base>` (reescribe TODOS los enlaces
 *  relativos de la página de una vez) ni `<meta http-equiv>` (un refresco o una
 *  CSP propia). `<title>` y la meta description tampoco: los escribe
 *  `ensurePageMeta`, y dos escritores del mismo campo es cómo se pierde uno.
 *
 *  Queda una cosa, que es justo la que hacía falta: la hoja de Google Fonts.
 *  Sin ella, cambiar la tipografía deja el `font-family` apuntando a una fuente
 *  que el navegador no tiene y la página cae al serif del sistema. */
function nodoDeCabezaPermitido(fragmento: string): boolean {
  const t = fragmento.trim();
  if (!t.startsWith("<link")) return false;
  if (/<\s*\//.test(t.slice(5))) return false; // un solo elemento vacío
  const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(t)?.[1]?.trim() ?? "";
  return (
    href.startsWith("https://fonts.googleapis.com/") ||
    href.startsWith("https://fonts.gstatic.com/")
  );
}

function separarPorEtiqueta(fragmento: string): string[] {
  // Sin analizador: los nodos permitidos son `<link>` sueltos. Se parte por el
  // cierre para poder validar uno a uno y rechazar la tanda entera si alguno
  // no pasa — aceptar "los que valgan" dejaría al modelo creyendo que puso algo
  // que no está.
  return fragmento
    .split(/(?<=>)/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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

/** Añade los nodos al `<head>`, sin duplicar lo que ya está. */
export function applyHeadOp(html: string, result: HeadOpResult): string {
  if (result.kind !== "nodos") return html;
  const nuevos = separarPorEtiqueta(result.html).filter((nodo) => {
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(nodo)?.[1];
    // Repetir la hoja de fuentes no rompe la página, pero la hace pesar dos
    // veces y el horneado de fuentes al publicar tiene que resolverla dos
    // veces. Un turno que pide lo que ya está no cambia nada.
    return href ? !html.includes(href) : true;
  });
  return nuevos.length === 0 ? html : insertarEnCabeza(html, nuevos.join(""));
}

/** Frase para el USUARIO cuando el cambio de estilo se descartó. En español:
 *  la ve él, no el modelo. */
export function documentOpAviso(target: "styles" | "head", reason: DocumentOpRejection): string {
  const porque: Record<DocumentOpRejection, string> = {
    varias: "mandó dos versiones y no se puede saber cuál quería",
    op_no_soportada:
      target === "head"
        ? "intentó reemplazar o borrar la cabecera entera, y sólo se puede añadir"
        : "usó una operación que no aplica sobre una hoja de estilos",
    vacio: "mandó el bloque vacío",
    demasiado_grande: `el CSS pasa de ${Math.floor(MAX_MODEL_CSS_BYTES / 1024)} KiB`,
    no_permitido:
      target === "head"
        ? "intentó meter algo que no es una hoja de fuentes de Google"
        : "el CSS traía etiquetas dentro",
    marcador_de_editor: "traía un marcador reservado del editor",
  };
  const que = target === "head" ? "la hoja de fuentes" : "el cambio de estilo";
  return `No pude aplicar ${que}: ${porque[reason]}. El resto de la edición sí se guardó.`;
}
