import { parse, type HTMLElement, type Node } from "node-html-parser";

/**
 * THE SLIDE FORMAT, checked before anything renders (as Claude's Slides checks its subset).
 *
 * A slide file is one `<section id="<id>">` on a 1920×1080 canvas with inline styles. The vocabulary is CLOSED
 * where it has to become a PowerPoint object — tags, text, fills, borders, corners, shadows, images, tables — so
 * every element exports native and nothing needs to be marked to become a picture. Layout is NOT closed: margin,
 * z-index, em, calc() and CSS variables are the browser's to resolve, and the export measures what it laid out
 * (Claude also closes layout because its slide editor rewrites it; there is no such editor here).
 *
 * Every error names the file, line:col, the element and the closest supported change. A usual HTML name with an
 * equivalent in the format (`<strong>`, `<header>`, `<h4>`) is read as that and reported as a note.
 */
export interface SlideCheck {
  readonly errors: string[];
  readonly notes: string[];
  readonly notesText: string | null;
  /** Saved outputs the slide shows (`artifactId@revision/output`). */
  readonly assets: string[];
  /** The same findings anchored to the file, for the `<new-diagnostics>` of the save that wrote it. */
  readonly diagnostics: { line: number; column: number; severity: "Error" | "Info"; message: string }[];
}

const TEXT_BLOCKS = new Set(["h1", "h2", "h3", "p", "li"]);
const INLINE = new Set(["b", "i", "u", "s", "a", "span", "br"]);
const KNOWN = new Set(["section", "div", "ul", "ol", "table", "thead", "tbody", "tr", "th", "td", "img", "svg", "hr", "aside", ...TEXT_BLOCKS, ...INLINE]);
const ALIASES: Readonly<Record<string, string>> = {
  strong: "b", em: "i", cite: "i", mark: "span", small: "span", label: "span", time: "span", abbr: "span", code: "span", del: "s", ins: "u",
  header: "div", footer: "div", main: "div", article: "div", nav: "div", figure: "div", blockquote: "div", address: "div",
  h4: "h3", h5: "h3", h6: "h3", figcaption: "p",
};
const NO_SCRIPTS = "no scripts in a slide; draw a chart as an <svg> or as <div> bars";
const TAG_HINTS: Readonly<Record<string, string>> = {
  button: "a <p> with background, padding and border-radius is a pill",
  canvas: "draw it as an <svg>", script: NO_SCRIPTS, noscript: NO_SCRIPTS,
  style: 'write each element\'s CSS in its inline style=""; shared values can be CSS variables on the <section>',
  link: 'write each element\'s CSS in its inline style=""',
  iframe: "a slide shows no other page; a screenshot is an <img>", video: "a still frame is an <img>", audio: "a slide has no sound",
  picture: '<img src="asset:…">', source: '<img src="asset:…">', object: "<img> or <svg>", embed: "<img> or <svg>",
  form: "a slide is not a form; show the field as text in a painted <div>", input: "a slide is not a form; show the field as text in a painted <div>",
  select: "a slide is not a form; show the field as text in a painted <div>", textarea: "a slide is not a form; show the field as text in a painted <div>",
  html: "the file is the <section> alone", head: "the file is the <section> alone", body: "the file is the <section> alone",
  dl: "a <ul> of <li>, or a two-column <table>", pre: "a <p> with white-space: pre-wrap",
};

const LAYOUT = /^(display|position|left|top|right|bottom|inset|width|height|(min|max)-(width|height)|margin(-(top|right|bottom|left|inline|block)(-(start|end))?)?|padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?|box-sizing|flex(-(direction|wrap|flow|grow|shrink|basis))?|order|grid(-(template(-(columns|rows|areas))?|column(-(start|end))?|row(-(start|end))?|area|auto-(flow|columns|rows)))?|(row-|column-)?gap|(align|justify|place)-(items|self|content)|aspect-ratio|overflow(-[xy])?|z-index|vertical-align|object-fit|object-position|visibility)$/;
const TEXT = /^(font(-(family|size|weight|style|variant-numeric|stretch|kerning|feature-settings|optical-sizing))?|line-height|letter-spacing|word-spacing|text-(align|transform|decoration(-(line|color|style|thickness))?|indent|shadow|wrap|rendering|underline-offset)|white-space|color|-webkit-text-stroke(-(width|color))?|hyphens|word-break|overflow-wrap|list-style(-(type|position))?)$/;
const PAINT = /^(background(-color)?|border(-(top|right|bottom|left))?(-(width|style|color))?|border-((top|bottom)-(left|right))-radius|border-radius|box-shadow|opacity|transform|transform-origin)$/;
const IGNORED = /^(cursor|pointer-events|user-select|-webkit-font-smoothing|-moz-osx-font-smoothing|transition(-.+)?|will-change|content-visibility|contain)$/;
const OVERLAY = "use opacity or a painted overlay <div>";
const PHOTO_BEHIND = "a photo is a pinned <img> listed first (position:absolute; object-fit:cover), behind the rest";
const PROP_HINTS: Readonly<Record<string, string>> = {
  filter: OVERLAY, "backdrop-filter": OVERLAY, "-webkit-backdrop-filter": OVERLAY, "mix-blend-mode": OVERLAY, "isolation": OVERLAY,
  "clip-path": "use border-radius, or draw the shape as an <svg>", mask: "use border-radius, or draw the shape as an <svg>", "-webkit-mask": "use border-radius, or draw the shape as an <svg>",
  "background-image": PHOTO_BEHIND, "background-size": PHOTO_BEHIND, "background-position": PHOTO_BEHIND, "background-repeat": PHOTO_BEHIND, "background-attachment": PHOTO_BEHIND, "background-origin": PHOTO_BEHIND,
  "background-clip": "a solid color on the text", "-webkit-background-clip": "a solid color on the text", "-webkit-text-fill-color": "a solid color on the text",
  float: "a flex row", animation: 'slides do not animate; data-transition="fade" on the <section> changes slides',
  columns: "a flex row of columns", "column-count": "a flex row of columns", "writing-mode": "transform: rotate(-90deg) on the text block",
  "text-overflow": "size the box to its text, or shorten the text", outline: "border", "border-image": "border, or a painted <div>",
};

const at = (source: string) => {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (offset: number) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1]! <= offset) line++;
    return { line: line + 1, column: offset - starts[line]! + 1 };
  };
};

/** `a: b; c: d` → [["a","b"],["c","d"]], splitting only outside parentheses and quotes. */
export function declarations(style: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0, quote = "", start = 0;
  const push = (end: number) => {
    const part = style.slice(start, end), colon = part.indexOf(":");
    if (colon > 0) out.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important\s*$/i, "").trim()]);
    start = end + 1;
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) push(i);
  }
  push(style.length);
  return out;
}

const BORDER_STYLE = /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;
const isWidth = (t: string) => /^(thin|medium|thick|-?\d*\.?\d+(px|pt|em|rem)?)$/.test(t);
/** The parts of a border shorthand; anything not a width or a style is the color. */
function borderParts(value: string) {
  const tokens = value.match(/[a-z-]+\([^)]*\)|[^\s]+/gi) ?? [];
  let width: string | undefined, style: string | undefined;
  const color: string[] = [];
  for (const t of tokens) { if (!style && BORDER_STYLE.test(t.toLowerCase())) style = t.toLowerCase(); else if (!width && isWidth(t.toLowerCase())) width = t; else color.push(t.toLowerCase()); }
  return { width, style, color: color.length ? color.join(" ") : undefined };
}

/** PowerPoint strokes a shape with one style and one color; widths may differ per side (each side is then a line). */
function borderProblem(decls: [string, string][]): [string, string] | null {
  const sides = { top: {} as { width?: string; style?: string; color?: string }, right: {}, bottom: {}, left: {} } as Record<string, { width?: string; style?: string; color?: string }>;
  let culprit = "border";
  for (const [prop, value] of decls) {
    if (/var\(/i.test(value)) return null;
    const m = /^border(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/.exec(prop);
    if (!m) continue;
    const targets = m[1] ? [m[1]] : ["top", "right", "bottom", "left"];
    for (const side of targets) {
      if (m[2]) sides[side]![m[2] as "width" | "style" | "color"] = m[2] === "width" ? value : value.toLowerCase();
      else { const p = borderParts(value); sides[side] = { width: p.width ?? (p.style && p.style !== "none" ? "medium" : sides[side]!.width), style: p.style ?? "none", color: p.color }; }
    }
    if (m[1]) culprit = prop;
  }
  const visible = Object.values(sides).filter((s) => s.style && s.style !== "none" && s.style !== "hidden" && !/^0(px|pt)?$/.test(s.width ?? ""));
  const key = (s: { style?: string; color?: string }) => `${s.style}|${s.color ?? "currentcolor"}`;
  if (visible.length > 1 && new Set(visible.map(key)).size > 1) {
    const value = decls.find(([p]) => p === culprit)?.[1] ?? "";
    return [`${culprit}: ${value}`, "PowerPoint draws one style and color for every side (widths may differ); for an accent bar or a different side use a painted 4px <div>"];
  }
  return null;
}

function radiusProblem(decls: [string, string][]): [string, string] | null {
  for (const [prop, value] of decls) {
    if (prop === "border-radius" && !/var\(/i.test(value)) {
      const parts = value.split("/")[0]!.trim().split(/\s+/);
      if (new Set(parts).size > 1) return [`border-radius: ${value}`, "PowerPoint rounds every corner the same: one radius for every corner (or 50% for a circle or pill)"];
    }
  }
  const corners = decls.filter(([p]) => /^border-(top|bottom)-(left|right)-radius$/.test(p));
  if (corners.length && corners.length < 4 || new Set(corners.map(([, v]) => v)).size > 1) {
    const [prop, value] = corners[0]!;
    return [`${prop}: ${value}`, "PowerPoint rounds every corner the same: one radius for every corner (or 50% for a circle or pill)"];
  }
  return null;
}

function transformProblem(value: string): string | null {
  for (const fn of value.toLowerCase().match(/[a-z0-9-]+(?=\()/g) ?? []) if (!/^(translate|translatex|translatey|rotate|rotatez)$/.test(fn)) return fn;
  return null;
}

function styleProblems(tag: string, style: string): [string, string][] {
  const decls = declarations(style);
  const problems: [string, string][] = [];
  for (const [prop, value] of decls) {
    if (prop.startsWith("--")) continue;
    if (/url\(/i.test(value)) { problems.push([`url(): ${prop}: ${value}`, `no files or links in CSS; ${PHOTO_BEHIND}`]); continue; }
    if (prop === "background-image" && /^(none|(repeating-)?(linear|radial|conic)-gradient\(.*\))$/i.test(value)) continue;
    if (PROP_HINTS[prop] && !(prop === "background-clip" && /^(border-box|padding-box)$/i.test(value))) { problems.push([`${prop}: ${value} has no PowerPoint object`, PROP_HINTS[prop]!]); continue; }
    if (/^(animation|transition)-/.test(prop) && prop.startsWith("animation")) { problems.push([`${prop}: ${value}`, PROP_HINTS.animation!]); continue; }
    if (prop === "transform") { const fn = transformProblem(value); if (fn) problems.push([`transform: ${value}`, `${fn}() has no PowerPoint equivalent; set width/height or font-size (translate and rotate are supported)`]); continue; }
    if (prop === "position" && /^(fixed|sticky)$/i.test(value)) { problems.push([`position: ${value}`, "position:absolute pins to the slide"]); continue; }
    if (!(LAYOUT.test(prop) || TEXT.test(prop) || PAINT.test(prop) || IGNORED.test(prop))) problems.push([`${prop}: ${value} is not in the slide format`, "see the format's list of CSS"]);
  }
  void tag;
  const border = borderProblem(decls); if (border) problems.push(border);
  const radius = radiusProblem(decls); if (radius) problems.push(radius);
  return problems;
}

const SVG_UNSAFE = /<\s*(script|foreignobject|iframe|object|embed)\b|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?!#)|url\(\s*["']?\s*(?!#)/i;
const OUTPUT_SRC = /^asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@[1-9]\d*\/\d+)$/;

export function checkSlideSource(id: string, source: string): SlideCheck {
  const file = `slides/${id}.html`, where = at(source);
  const errors: string[] = [], notes: string[] = [], assets: string[] = [];
  let notesText: string | null = null, count = 0;
  const diagnostics: SlideCheck["diagnostics"] = [];
  const fail = (offset: number, what: string, hint: string) => { const p = where(offset); errors.push(`${file} ${p.line}:${p.column} ${what} — ${hint}`); diagnostics.push({ ...p, severity: "Error", message: `${what} — ${hint}` }); };
  const textStart = (n: Node) => n.range[0] + (n.rawText.length - n.rawText.trimStart().length);
  const note = (offset: number, what: string) => { const p = where(offset); notes.push(`${file} ${p.line}:${p.column} ${what}`); diagnostics.push({ ...p, severity: "Info", message: what }); };
  const root = parse(source, { comment: false, lowerCaseTagName: false, blockTextElements: { script: true, noscript: true, style: true } });
  const top = root.childNodes.filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.rawText.trim()));
  const section = top[0] as HTMLElement | undefined;
  if (top.length !== 1 || section?.nodeType !== 1 || section.rawTagName.toLowerCase() !== "section") {
    const first = top.find((n) => !(n.nodeType === 1 && (n as HTMLElement).rawTagName.toLowerCase() === "section")) ?? top[0];
    fail(first?.range[0] ?? 0, `a slide file holds exactly one <section id="${id}"> and nothing else`, "no <html>, <head> or <body>, no text before or after it");
    return { errors: [errors[0]!.replace(/ — /, ": ").replace(/^(\S+ \S+) a slide/, "$1: a slide")], notes, notesText, assets, diagnostics };
  }
  const sectionId = section.getAttribute("id");
  if (sectionId !== id) fail(section.range[0], `<section>: its id is "${sectionId ?? ""}" but the file is ${id}.html`, "the section's id is the file's name");

  const visit = (el: HTMLElement, parentTag: string) => {
    if (++count > 500) { if (count === 501) fail(el.range[0], "more than 500 elements on one slide", "split the slide"); return; }
    const raw = el.rawTagName.toLowerCase();
    if (!KNOWN.has(raw) && !ALIASES[raw]) { fail(el.range[0], `<${raw}>: not in the slide format`, TAG_HINTS[raw] ?? "use the format's tags: section div h1 h2 h3 p ul ol li b i u s a span br img svg table tr th td hr aside"); return; }
    const tag = ALIASES[raw] ?? raw;
    if (ALIASES[raw]) note(el.range[0], `<${raw}>: read as <${tag}>`);
    for (const [name, value] of Object.entries(el.attributes)) {
      const n = name.toLowerCase();
      if (n === "class") fail(el.range[0], `<${raw}>: class: a slide has no stylesheet`, 'write its CSS in style=""');
      else if (/^on/.test(n) && tag !== "svg") fail(el.range[0], `<${raw}>: ${n}: no scripts in a slide`, 'remove it; a link is <a href="https://…">');
      else if (n === "style" && tag !== "svg") for (const [what, hint] of styleProblems(tag, value)) fail(el.range[0], `<${raw}>: ${what}`, hint);
    }
    if (tag === "a") { const href = el.getAttribute("href") ?? ""; if (!/^(https:\/\/|mailto:)/i.test(href)) fail(el.range[0], `<a>: href: ${href}`, "links are https:// or mailto:"); }
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "", m = OUTPUT_SRC.exec(src);
      if (m) assets.push(m[1]!); else fail(el.range[0], `<img>: src: ${src.slice(0, 80) || "(none)"}`, "images come from saved outputs: asset:<artifactId>@<revision>/<output> from inspect_artifact");
      if (el.getAttribute("alt") === undefined) note(el.range[0], "<img>: no alt; say what it shows (alt=\"\" if decorative)");
      return;
    }
    if (tag === "svg") {
      const markup = source.slice(el.range[0], el.range[1]);
      if (Buffer.byteLength(markup) > 52 * 1024) fail(el.range[0], `<svg>: ${Math.ceil(Buffer.byteLength(markup) / 1024)} KB`, "an inline <svg> is 52 KB at most; simplify the drawing");
      else if (SVG_UNSAFE.test(markup)) fail(el.range[0], "<svg>: a drawing is an image", "no <script>, on*=, <foreignObject> or URLs inside it; only local #id references");
      return;
    }
    if (tag === "aside") {
      const last = section.childNodes.filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.rawText.trim())).at(-1);
      if (parentTag !== "section" || last !== el) fail(el.range[0], "<aside>: speaker notes", "one <aside>, the section's last child");
      else if (el.childNodes.some((n) => n.nodeType === 1)) fail(el.range[0], "<aside>: speaker notes are plain text", "write the notes without tags");
      else if (el.text.trim().length > 4000) fail(el.range[0], "<aside>: speaker notes", "4000 characters at most");
      else notesText = el.text.trim();
      return;
    }
    const isText = TEXT_BLOCKS.has(tag), isInline = INLINE.has(tag);
    if (tag === "li" && parentTag !== "ul" && parentTag !== "ol") fail(el.range[0], "<li>: outside a list", "put it in a <ul> or <ol>");
    const children = el.childNodes;
    const loose = children.filter((n) => n.nodeType === 3 && n.rawText.trim());
    const blocks = children.filter((n): n is HTMLElement => n.nodeType === 1 && !INLINE.has(ALIASES[(n as HTMLElement).rawTagName.toLowerCase()] ?? (n as HTMLElement).rawTagName.toLowerCase()));
    if (loose.length && (tag === "section" || tag === "ul" || tag === "ol" || tag === "table" || tag === "tr" || tag === "thead" || tag === "tbody")) fail(textStart(loose[0]!), `text directly in <${tag}>: "${loose[0]!.rawText.trim().slice(0, 40)}"`, tag === "section" ? "put it in a <p>" : tag === "ul" || tag === "ol" ? "put it in a <li>" : "put it in a <td>");
    else if (loose.length && tag === "div" && blocks.length) fail(textStart(loose[0]!), `<div> mixes text and blocks: "${loose[0]!.rawText.trim().slice(0, 40)}"`, "put the text in a <p>");
    if ((isText || isInline || tag === "th" || tag === "td") && blocks.length) {
      const b = blocks[0]!;
      fail(b.range[0], `<${b.rawTagName.toLowerCase()}> inside <${raw}>`, `a <${tag}> holds text and inline tags (b i u s a span br) only`);
      return;
    }
    if ((tag === "th" || tag === "td") && (el.getAttribute("colspan") || el.getAttribute("rowspan"))) fail(el.range[0], `<${tag}>: merged cells`, "no colspan/rowspan; a group header is a painted flex row above the table");
    for (const child of children) if (child.nodeType === 1) visit(child as HTMLElement, tag);
  };
  visit(section, "");
  return { errors, notes, notesText, assets, diagnostics };
}

export type { Node };
