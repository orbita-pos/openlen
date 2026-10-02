/**
 * UNA PÁGINA DE INTERNET, EN MARKDOWN (F2 de plans/len-agente-2026: `web_fetch`).
 *
 * La forma de DeepSeek (`packages/web/tool-web/src/fetch.ts` @639ed01, que usa
 * turndown con tablas GFM): fuera lo ACTIVO —`script`, `style`, `noscript`,
 * `template`, `iframe`, `object`, `embed`— y lo OCULTO —`hidden`,
 * `aria-hidden="true"`, `input type=hidden`, `display:none`,
 * `visibility:hidden|collapse`—; encabezados con `#`, listas con `-`, código
 * en bloques con valla, tablas y tachado de GFM. Lo que no se puede convertir con
 * seguridad (más de 512 niveles de anidamiento) es una marca fija, nunca el
 * HTML crudo. Escrito sobre `node-html-parser`, que ya está en el repo: turndown
 * no lo está, y en este worktree no se instala nada.
 *
 * Por qué markdown y no el texto a secas de `leer_de_internet`: una carta o unos
 * horarios son TABLAS, y aplanados pierden qué precio va con qué plato; y los
 * enlaces son lo que deja a Len seguir leyendo.
 *
 * Puro: lo prueba vitest.
 */
import { parse, type HTMLElement, type Node } from "node-html-parser";

/** Lo que se dice en vez de una página que no se puede convertir con seguridad. */
export const OMITIDO = "[HTML content omitted: it could not be converted safely.]";
/** Hasta dónde se baja: más es un ataque, no una página. */
export const MAX_PROFUNDIDAD = 512;

// `title` también fuera, y no por activo: vuelve APARTE. Dentro del cuerpo —un
// HTML sin `<head>`— salía dos veces, y lo leído dos veces se cree el doble.
const ACTIVOS = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "canvas", "head", "title"]);
const BLOQUES = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "nav", "aside", "address", "figure", "figcaption",
  "form", "fieldset", "dl", "dt", "dd", "details", "summary", "body", "html",
]);

function oculto(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  if ((el.getAttribute("aria-hidden") ?? "").toLowerCase() === "true") return true;
  if (el.rawTagName?.toLowerCase() === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden") return true;
  return (el.getAttribute("style") ?? "").split(";").some((d) => {
    const i = d.indexOf(":");
    if (i === -1) return false;
    const prop = d.slice(0, i).trim().toLowerCase();
    const valor = d.slice(i + 1).trim().toLowerCase().replace(/\s*!important\s*$/, "");
    return (prop === "display" && valor === "none") || (prop === "visibility" && (valor === "hidden" || valor === "collapse"));
  });
}

function profundidad(n: Node, hasta: number): number {
  let max = 0;
  const pila: [Node, number][] = [[n, 0]];
  while (pila.length > 0) {
    const [x, d] = pila.pop()!;
    if (d > max) max = d;
    if (max > hasta) return max;
    for (const h of x.childNodes) pila.push([h, d + 1]);
  }
  return max;
}

/** Una URL absoluta y legible, o null si no lo es (`javascript:`, `data:`…). */
function absoluta(href: string | undefined, base: string | null): string | null {
  if (!href) return null;
  try {
    const u = base ? new URL(href, base) : new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" || u.protocol === "tel:" ? u.href : null;
  } catch {
    return null;
  }
}

const enLinea = (s: string) => s.replace(/\s+/g, " ");
const celda = (s: string) => enLinea(s).trim().replace(/\|/g, "\\|") || " ";

interface Contexto {
  readonly base: string | null;
  /** Dentro de `pre`: el espacio se respeta. */
  readonly pre: boolean;
  /** Sangría de la lista en la que se está. */
  readonly sangria: string;
}

function hijos(el: HTMLElement | Node, c: Contexto): string {
  return el.childNodes.map((h) => nodo(h, c)).join("");
}

function lista(el: HTMLElement, c: Contexto, ordenada: boolean): string {
  let i = 0;
  const filas = el.childNodes
    .filter((h): h is HTMLElement => h.nodeType === 1 && (h as HTMLElement).rawTagName?.toLowerCase() === "li" && !oculto(h as HTMLElement))
    .map((li) => {
      i += 1;
      const marca = ordenada ? `${i}. ` : "- ";
      const dentro = hijos(li, { ...c, sangria: `${c.sangria}  ` }).trim().replace(/\n{2,}/g, "\n");
      return `${c.sangria}${marca}${dentro.replace(/\n/g, `\n${c.sangria}  `)}`;
    });
  return filas.length > 0 ? `\n\n${filas.join("\n")}\n\n` : "";
}

function tabla(el: HTMLElement, c: Contexto): string {
  const filas = el
    .querySelectorAll("tr")
    .filter((tr) => !oculto(tr))
    .map((tr) => tr.childNodes.filter((h): h is HTMLElement => h.nodeType === 1 && /^(td|th)$/i.test((h as HTMLElement).rawTagName ?? "")));
  const conCeldas = filas.filter((f) => f.length > 0);
  if (conCeldas.length === 0) return "";
  const ancho = Math.max(...conCeldas.map((f) => f.length));
  const texto = (td: HTMLElement) => celda(hijos(td, { ...c, sangria: "" }));
  const linea = (f: HTMLElement[]) => `| ${Array.from({ length: ancho }, (_, k) => (f[k] ? texto(f[k]!) : " ")).join(" | ")} |`;
  const [cabeza, ...cuerpo] = conCeldas;
  return `\n\n${[linea(cabeza!), `|${" --- |".repeat(ancho)}`, ...cuerpo.map(linea)].join("\n")}\n\n`;
}

function nodo(n: Node, c: Contexto): string {
  if (n.nodeType === 3) return c.pre ? n.rawText : enLinea(n.text);
  if (n.nodeType !== 1) return "";
  const el = n as HTMLElement;
  const tag = el.rawTagName?.toLowerCase() ?? "";
  if (ACTIVOS.has(tag) || oculto(el)) return "";
  if (/^h[1-6]$/.test(tag)) {
    const t = enLinea(hijos(el, c)).trim();
    return t ? `\n\n${"#".repeat(Number(tag[1]))} ${t}\n\n` : "";
  }
  switch (tag) {
    case "br":
      return c.pre ? "\n" : "  \n";
    case "hr":
      return "\n\n---\n\n";
    case "ul":
      return lista(el, c, false);
    case "ol":
      return lista(el, c, true);
    case "table":
      return tabla(el, c);
    case "pre": {
      const codigo = el.text.replace(/\n+$/, "");
      const valla = codigo.includes("```") ? "````" : "```";
      return `\n\n${valla}\n${codigo}\n${valla}\n\n`;
    }
    case "code":
      return c.pre ? el.text : `\`${enLinea(el.text).trim()}\``;
    case "blockquote": {
      const t = hijos(el, c).trim();
      return t ? `\n\n${t.split("\n").map((l) => `> ${l}`).join("\n")}\n\n` : "";
    }
    case "strong":
    case "b": {
      const t = hijos(el, c).trim();
      return t ? `**${t}**` : "";
    }
    case "em":
    case "i": {
      const t = hijos(el, c).trim();
      return t ? `*${t}*` : "";
    }
    case "del":
    case "s":
    case "strike": {
      const t = hijos(el, c).trim();
      return t ? `~~${t}~~` : "";
    }
    case "a": {
      const t = enLinea(hijos(el, c)).trim();
      const href = absoluta(el.getAttribute("href"), c.base);
      if (!t) return "";
      return href ? `[${t}](${href})` : t;
    }
    case "img": {
      const alt = enLinea(el.getAttribute("alt") ?? "").trim();
      const src = absoluta(el.getAttribute("src"), c.base);
      return alt && src ? `![${alt}](${src})` : alt;
    }
    case "li":
      return `\n- ${hijos(el, c).trim()}\n`;
    default:
      return BLOQUES.has(tag) ? `\n\n${hijos(el, c)}\n\n` : hijos(el, c);
  }
}

/** El título y el cuerpo en markdown de una página, o la marca de omitido. */
export function htmlAMarkdown(html: string, base: string | null = null): { titulo: string; markdown: string } {
  let doc: HTMLElement;
  try {
    // `pre` NO va aquí: como bloque crudo dejaría sus `<code>` dentro del texto.
    doc = parse(html, { comment: false, blockTextElements: { script: true, noscript: true, style: true } });
  } catch {
    return { titulo: "", markdown: OMITIDO };
  }
  const titulo = enLinea(doc.querySelector("title")?.text ?? "").trim();
  if (profundidad(doc, MAX_PROFUNDIDAD) > MAX_PROFUNDIDAD) return { titulo, markdown: OMITIDO };
  const raiz = doc.querySelector("body") ?? doc;
  const md = hijos(raiz, { base, pre: false, sangria: "" })
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, (fin) => (fin === "  " ? fin : "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { titulo, markdown: md };
}
