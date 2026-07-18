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
  } catch {
    root = null;
  }

  const title = (pageTitle(html) || hostOf(baseUrl)).slice(0, 120);
  const parts: string[] = [`# ${title}\n`];

  // El traverse de node-html-parser (querySelector/.text) es RECURSIVO y
  // desborda el stack con HTML muy anidado (from-html acepta HTML crudo).
  // Todo el bloque va en try/catch: cualquier fallo degrada a solo-título,
  // jamás lanza (invariante de totalidad; cazado en el review 2026-07-17).
  try {
  if (root) {
    const scope = root.querySelector("main") ?? root.querySelector("body") ?? root;

    // Resumen (blockquote) — meta description.
    const desc = clean(
      root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    ).slice(0, 300);
    if (desc) parts.push(`> ${desc}\n`);

    // Párrafo de contexto — primer <p> sustancioso del scope. Es la ÚNICA
    // línea sin prefijo de marcador, así que se neutraliza cualquier char que
    // arranque un bloque markdown (#, >, -, *, |, =) para que no forje un
    // heading/blockquote falso.
    const p = scope
      .querySelectorAll("p")
      .map((n) => clean(n.text).replace(/^[#>\-*|=\s]+/, ""))
      .find((t) => t.length >= 40);
    if (p) parts.push(`${p.slice(0, 200).replace(/\s+\S*$/, "")}…\n`);

    // Secciones — h2 (+ h3 si hay pocos h2), dedup, tope.
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
    if (sections.length) parts.push(`## Secciones\n\n${sections.map((s) => `- ${s}`).join("\n")}\n`);

    // Enlaces — nav/header + contacto (wa.me/mailto/tel), dedup por URL, tope.
    const anchors = [
      ...root.querySelectorAll("nav a"),
      ...root.querySelectorAll("header a"),
      ...root.querySelectorAll('a[href*="wa.me"], a[href^="mailto:"], a[href^="tel:"]'),
    ];
    const seenL = new Set<string>();
    const links: string[] = [];
    for (const a of anchors) {
      const url = absolutize(a.getAttribute("href") ?? "", baseUrl);
      if (!url || seenL.has(url)) continue;
      const label = clean(a.text) || url.replace(/^https?:\/\//, "");
      seenL.add(url);
      links.push(`- [${label.slice(0, 60)}](${url})`);
      if (links.length >= MAX_LINKS) break;
    }
    if (links.length) parts.push(`## Enlaces\n\n${links.join("\n")}\n`);
  }
  } catch {
    /* traverse falló (p.ej. stack overflow por anidamiento extremo) →
       degradamos a lo que se haya acumulado (mínimo el título). */
  }

  // Páginas — subpáginas publicadas.
  const pages = (input.pages ?? []).filter((p) => p.slug);
  if (pages.length) {
    const rows = pages.map(
      (p) => `- [${clean(p.title) || p.slug}](${baseUrl}/${p.slug}/)`,
    );
    parts.push(`## Páginas\n\n${rows.join("\n")}\n`);
  }

  // Ensamble con recorte por prioridad (parts ya está en orden de prioridad:
  // título, resumen, contexto, secciones, enlaces, páginas). Quita bloques
  // desde el final hasta caber en MAX_BYTES; el título (parts[0]) siempre queda.
  let out = parts.join("\n");
  while (Buffer.byteLength(out, "utf8") > MAX_BYTES && parts.length > 1) {
    parts.pop();
    out = parts.join("\n");
  }
  // Si aún excede (un solo título gigante), recorta el título mismo.
  if (Buffer.byteLength(out, "utf8") > MAX_BYTES) {
    out = `# ${title.slice(0, MAX_BYTES - 8)}\n`;
  }
  return out.endsWith("\n") ? out : `${out}\n`;
}
