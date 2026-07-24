import { parse, type HTMLElement } from "node-html-parser";

export interface LlmsTxtInput {
  html: string;
  baseUrl: string;
  pages?: Array<{ slug: string; title: string }>;
}

const MAX_BYTES = 8192;
const MAX_SECTIONS = 12;
const MAX_LINKS = 15;
const BRAND_SUFFIX_RE = /\s*[—·|-]\s*OpenLen\s*$/i;

// Chrome horneado por los módulos: FAB de WhatsApp, widget de contacto,
// switcher de idioma y las bandas de módulo. Sus enlaces son CONTROLES de la
// página (abrir un chat, cambiar de idioma), no páginas del sitio — y llms.txt
// indexa páginas.
const MODULE_CHROME_SEL = [
  "[data-ol-wa-button]",
  "[data-ol-contact-widget]",
  "[data-ol-lang-switcher]",
  "[data-ol-collection-section]",
  "[data-ol-bookings-section]",
  "[data-ol-comments-section]",
  "[data-ol-chat-section]",
].join(",");

// Colapsa whitespace y neutraliza los caracteres que romperían el markdown
// del archivo (corchetes de link, backticks, saltos de línea). Total.
function clean(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[[\]`]/g, "")
    .trim();
}

function textOf(el: HTMLElement | null): string {
  return el ? clean(el.text) : "";
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "página";
  }
}

function absolutize(href: string, baseUrl: string): string | null {
  // Strip control chars (newline/tab/etc.) ANTES de cualquier rama — un href
  // con \n forjaría líneas markdown (## falso, prompt injection) dentro del
  // archivo que leen los agentes. Cazado en el review 2026-07-17.
  // eslint-disable-next-line no-control-regex
  const h = href.replace(/[\u0000-\u001f]/g, "").trim();
  if (!h || h.startsWith("#") || /^(javascript|data):/i.test(h)) return null;
  let url: string | null = null;
  if (/^(mailto:|tel:)/i.test(h)) url = h;
  else if (/^https?:/i.test(h)) url = h;
  else if (h.startsWith("//")) url = `https:${h}`;
  else {
    try {
      url = new URL(h, `${baseUrl}/`).toString();
    } catch {
      return null;
    }
  }
  // Un URL que contenga los chars que rompen el contexto `(url)` de un link
  // markdown (paréntesis, corchetes, espacio, backtick) es malformado o
  // hostil → se descarta.
  if (/[()[\]`\s]/.test(url)) return null;
  return url;
}

/** Título limpio: <title> sin sufijo de marca → primer <h1> → "". Total —
 *  ni parse ni el traverse recursivo pueden lanzar hacia afuera. */
export function pageTitle(html: string): string {
  try {
    const root = parse(html);
    // .text de node-html-parser INCLUYE cuerpos de <script>/<style> — un h1
    // con un script hijo (p.ej. el carrier data-ol-tw) contaminaría el
    // título. Fuera antes de extraer.
    root.querySelectorAll("script,style").forEach((n) => n.remove());
    const title = textOf(root.querySelector("title")).replace(BRAND_SUFFIX_RE, "").trim();
    if (title) return title;
    return textOf(root.querySelector("h1"));
  } catch {
    return "";
  }
}

export function buildLlmsTxt(input: LlmsTxtInput): string {
  const { html, baseUrl } = input;
  let root: HTMLElement | null = null;
  try {
    root = parse(html);
    // Mismo motivo que en pageTitle: .text incluye cuerpos de script/style —
    // el carrier data-ol-tw dentro de un <p>/<h*> se colaría al contenido.
    root.querySelectorAll("script,style").forEach((n) => n.remove());
  } catch {
    root = null;
  }

  // clean() también aquí: el fallback hostOf() no pasa por textOf y el
  // título es la única línea garantizada del archivo — jamás con estructura.
  const title = (clean(pageTitle(html) || hostOf(baseUrl)) || "página").slice(0, 120);

  // Formato del spec de llms.txt (que valida el audit de Lighthouse "Agentic
  // Browsing"): H1, blockquote, secciones de DETALLE (párrafos/prosa, sin
  // headings), y secciones H2 cuyos items DEBEN ser hiperenlaces [nombre](url).
  // Reglas que hacían fallar el audit y que aquí se cumplen:
  //   • Los "## Secciones" iban como bullets de TEXTO plano → prohibido.
  //     Ahora las secciones son una línea de prosa (detalle), no una lista H2.
  //   • El archivo DEBE contener ≥1 link markdown → hay fallback a la home.
  const detail: string[] = [];
  const links: string[] = [];
  const seenL = new Set<string>();
  const addLink = (label: string, url: string | null) => {
    if (!url || seenL.has(url) || links.length >= MAX_LINKS) return;
    seenL.add(url);
    const text = (clean(label) || url.replace(/^https?:\/\//, "")).slice(0, 60);
    links.push(`- [${text}](${url})`);
  };

  // El traverse de node-html-parser (querySelector/.text) es RECURSIVO y
  // desborda el stack con HTML muy anidado (from-html acepta HTML crudo).
  // Todo el bloque va en try/catch: cualquier fallo degrada a solo-título +
  // enlaces, jamás lanza (invariante de totalidad; cazado en review 2026-07-17).
  try {
    if (root) {
      const scope = root.querySelector("main") ?? root.querySelector("body") ?? root;

      // Resumen (blockquote) — meta description.
      const desc = clean(
        root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      ).slice(0, 300);
      if (desc) detail.push(`> ${desc}`);

      // Párrafo de contexto — primer <p> sustancioso. Se neutraliza cualquier
      // char que arranque un bloque markdown (#, >, -, *, |, =).
      const p = scope
        .querySelectorAll("p")
        .map((n) => clean(n.text).replace(/^[#>\-*|=\s]+/, ""))
        .find((t) => t.length >= 40);
      if (p) detail.push(`${p.slice(0, 200).replace(/\s+\S*$/, "")}…`);

      // Secciones — como PROSA (detalle), no como lista H2 de texto (el spec
      // exige que los items de un H2 sean links).
      const h2 = scope.querySelectorAll("h2").map((n) => clean(n.text)).filter(Boolean);
      const pool = h2.length >= 3 ? h2 : [...h2, ...scope.querySelectorAll("h3").map((n) => clean(n.text)).filter(Boolean)];
      const seenS = new Set<string>();
      const sections: string[] = [];
      for (const s of pool) {
        const v = s.slice(0, 80);
        if (v && !seenS.has(v.toLowerCase())) {
          seenS.add(v.toLowerCase());
          sections.push(v);
          if (sections.length >= MAX_SECTIONS) break;
        }
      }
      if (sections.length) detail.push(`Secciones: ${sections.join(" · ")}.`);

      // Links de nav/header + contacto (wa.me/mailto/tel), menos los que
      // pertenecen al chrome de los módulos.
      const chrome = new Set<HTMLElement>();
      for (const el of root.querySelectorAll(MODULE_CHROME_SEL)) {
        if (el.tagName === "A") chrome.add(el);
        for (const a of el.querySelectorAll("a")) chrome.add(a);
      }
      for (const a of [
        ...root.querySelectorAll("nav a"),
        ...root.querySelectorAll("header a"),
        ...root.querySelectorAll('a[href*="wa.me"], a[href^="mailto:"], a[href^="tel:"]'),
      ]) {
        if (chrome.has(a)) continue;
        addLink(a.text, absolutize(a.getAttribute("href") ?? "", baseUrl));
      }
    }
  } catch {
    /* traverse falló (anidamiento extremo) → degradamos a título + enlaces. */
  }

  // Subpáginas publicadas → links.
  for (const pg of input.pages ?? []) {
    if (pg.slug) addLink(pg.title, `${baseUrl}/${pg.slug}/`);
  }
  // El archivo DEBE tener ≥1 link markdown (regla del audit). La propia página
  // siempre sirve como fallback.
  if (links.length === 0) addLink(title, `${baseUrl}/`);

  const enlaces = `## Enlaces\n\n${links.join("\n")}`;

  // Ensamble en orden del spec: título → detalle → ## Enlaces. Bajo 8 KB se
  // recorta SOLO el detalle (secciones primero, luego contexto, luego resumen);
  // el título y ## Enlaces (requerido por el audit) siempre quedan.
  const build = (d: string[]) => `${[`# ${title}`, ...d, enlaces].join("\n\n")}\n`;
  let out = build(detail);
  while (Buffer.byteLength(out, "utf8") > MAX_BYTES && detail.length > 0) {
    detail.pop();
    out = build(detail);
  }
  return out;
}
