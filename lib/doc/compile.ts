// The OpenLen compiler — §9 of docs/document-model.md.
//
// A pure function: a Document compiles to ONE static HTML document with
// inlined CSS — no framework, no runtime — preserving the "published output
// is static HTML" invariant. The model is the source of truth; HTML is a
// one-way build artifact. Editor markers (`data-ol-id`) are emitted only when
// `opts.ids` is set; the publish path omits them.
//
// The style/structure core (`planStyles`, `domAttrs`, `DEFAULT_TAG`,
// `VOID_TAGS`) is exported and shared with the React renderer (`render.ts`) so
// both emitters produce byte-for-byte identical styling.

import { getLucideSvg } from "../lucide-svg";
import { isAnimationName, keyframesCss } from "./animations";
import type {
  Breakpoint,
  Condition,
  Document,
  Node,
  NodeId,
  NodeType,
  Props,
  StyleProps,
  StyleSet,
  StyleValue,
  TokenRegistry,
} from "./model";

export interface CompileOptions {
  /** Emit `data-ol-id` on every element — for the editor preview, not publish. */
  ids?: boolean;
}

export const DEFAULT_TAG: Record<NodeType, string> = {
  Page: "body",
  Box: "div",
  Text: "p",
  Image: "img",
  Icon: "span",
  Link: "a",
  Button: "button",
  Field: "input",
  Form: "form",
  Instance: "div",
  Slot: "div",
  Embed: "div",
};

export const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link"]);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A token id → a CSS-safe custom-property name. */
function tokenVar(id: string): string {
  return "--t-" + id.replace(/[^a-zA-Z0-9]+/g, "-");
}

// Rewrite literal `var(--token-id)` references inside string style values so
// they point at the *mangled* CSS var that tokenCss emits. Lets fixtures + AI
// outputs use natural CSS syntax (`background-color: "var(--bg)"`) instead of
// being forced into TokenRef objects everywhere. Only rewrites ids that exist
// in the registry — leaves unrelated CSS vars alone.
const VAR_RE = /var\(\s*(--[a-zA-Z0-9_-]+)(\s*,[^)]*)?\s*\)/g;
function rewriteStringVars(s: string, tokenIds: Set<string>): string {
  return s.replace(VAR_RE, (match, id, rest) =>
    tokenIds.has(id) ? `var(${tokenVar(id)}${rest ?? ""})` : match,
  );
}

function cssValue(v: StyleValue, tokenIds: Set<string>): string {
  if (typeof v === "object" && v !== null && "token" in v)
    return `var(${tokenVar(v.token)})`;
  if (typeof v === "string") return rewriteStringVars(v, tokenIds);
  return String(v);
}

function declarations(props: StyleProps, tokenIds: Set<string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}:${cssValue(v, tokenIds)}`)
    .join(";");
}

interface SelectorParts {
  media: string[];
  prefix: string;
  suffix: string;
}

function selectorParts(cond: Condition, bps: Breakpoint[]): SelectorParts {
  if (cond.kind === "breakpoint") {
    const bp = bps.find((b) => b.name === cond.bp);
    return {
      media: bp ? [`(min-width:${bp.minWidth}px)`] : [],
      prefix: "",
      suffix: "",
    };
  }
  if (cond.kind === "state")
    return { media: [], prefix: "", suffix: ":" + cond.state };
  if (cond.kind === "mode")
    return { media: [], prefix: `[data-ol-mode="${cond.mode}"] `, suffix: "" };
  const merged: SelectorParts = { media: [], prefix: "", suffix: "" };
  for (const c of cond.of) {
    const p = selectorParts(c, bps);
    merged.media.push(...p.media);
    merged.prefix += p.prefix;
    merged.suffix += p.suffix;
  }
  return merged;
}

function styleRules(
  style: StyleSet,
  cls: string,
  bps: Breakpoint[],
  tokenIds: Set<string>,
): string[] {
  const out: string[] = [];
  if (Object.keys(style.base).length)
    out.push(`.${cls}{${declarations(style.base, tokenIds)}}`);
  for (const layer of style.layers) {
    if (!Object.keys(layer.props).length) continue;
    const p = selectorParts(layer.condition, bps);
    let rule = `${p.prefix}.${cls}${p.suffix}{${declarations(layer.props, tokenIds)}}`;
    if (p.media.length) rule = `@media ${p.media.join(" and ")}{${rule}}`;
    out.push(rule);
  }
  return out;
}

function tokenCss(reg: TokenRegistry): string {
  const root: string[] = [];
  const byMode: Record<string, string[]> = {};
  const defaultMode = reg.modes[0] ?? "light";
  for (const [id, def] of Object.entries(reg.defs)) {
    const name = tokenVar(id);
    for (const [mode, val] of Object.entries(def.values)) {
      if (typeof val !== "string" && typeof val !== "number") continue;
      const decl = `${name}:${val}`;
      if (mode === "*" || mode === defaultMode) root.push(decl);
      else (byMode[mode] || (byMode[mode] = [])).push(decl);
    }
  }
  let css = root.length ? `:root{${root.join(";")}}` : "";
  for (const mode of Object.keys(byMode))
    css += `:root[data-ol-mode="${mode}"]{${byMode[mode].join(";")}}`;
  return css;
}

/** The style plan — one class per styled node + the full stylesheet. Shared by
 *  the HTML compiler and the React renderer so both emit identical styling. */
export interface StylePlan {
  classOf: Map<NodeId, string>;
  css: string;
}

export function planStyles(doc: Document): StylePlan {
  const classOf = new Map<NodeId, string>();
  const rules: string[] = [];
  const usedAnimations = new Set<string>();
  let seq = 0;
  const tokenIds = new Set(Object.keys(doc.tokens.defs));
  const collectAnim = (props: StyleProps): void => {
    const name = props["animation-name"];
    if (typeof name === "string" && name && isAnimationName(name)) {
      usedAnimations.add(name);
    }
  };
  const walk = (id: NodeId, nodes: Record<NodeId, Node>): void => {
    const node = nodes[id];
    if (!node) return;
    collectAnim(node.style.base);
    for (const layer of node.style.layers) collectAnim(layer.props);
    if (Object.keys(node.style.base).length || node.style.layers.length) {
      const cls = "ol-" + seq++;
      classOf.set(id, cls);
      rules.push(...styleRules(node.style, cls, doc.breakpoints, tokenIds));
    }
    for (const c of node.childIds) walk(c, nodes);
  };
  walk(doc.root, doc.nodes);
  // Component bodies live in their own node maps — plan their styles too.
  for (const def of Object.values(doc.components))
    walk(def.body.root, def.body.nodes);
  return {
    classOf,
    css:
      tokenCss(doc.tokens) + keyframesCss(usedAnimations) + rules.join(""),
  };
}

/** A node's DOM attributes (excluding class / data-ol-id) — shared core. */
export function domAttrs(node: Node): Record<string, string> {
  const p: Props = node.props;
  const str = (k: string): string =>
    typeof p[k] === "string" ? (p[k] as string) : "";
  const a: Record<string, string> = {};
  if (node.type === "Link" && str("href")) a.href = str("href");
  if (node.type === "Image") {
    a.src = str("src");
    a.alt = str("alt");
  }
  if (node.type === "Field") {
    if (str("kind")) a.type = str("kind");
    if (str("name")) a.name = str("name");
    if (str("placeholder")) a.placeholder = str("placeholder");
  }
  if (node.type === "Icon" && str("name")) a["data-icon"] = str("name");
  return a;
}

function compileText(props: Props): string {
  const runs = Array.isArray(props.runs) ? props.runs : [];
  return runs
    .map((raw) => {
      const run = raw as { text?: unknown; emphasis?: unknown };
      let t = esc(String(run.text ?? ""));
      const e = Array.isArray(run.emphasis) ? (run.emphasis as string[]) : [];
      if (e.includes("code")) t = `<code>${t}</code>`;
      if (e.includes("underline")) t = `<u>${t}</u>`;
      if (e.includes("italic")) t = `<em>${t}</em>`;
      if (e.includes("bold")) t = `<strong>${t}</strong>`;
      return t;
    })
    .join("");
}

// An Instance renders the referenced component's body in place. The body is a
// shared definition — not separately editable — so it carries no `data-ol-id`;
// the Instance node is the selectable unit. (A cyclic component definition
// would recurse forever; the authoring flow cannot create one — the
// editDefineComponent builder will guard against nesting a self-instance.)
function expandInstance(
  node: Node,
  doc: Document,
  classOf: Map<NodeId, string>,
): string {
  const cid =
    typeof node.props.componentId === "string"
      ? node.props.componentId
      : "";
  const def = doc.components[cid];
  if (!def) return "";
  return emitHtml(def.body.root, def.body.nodes, doc, classOf, false);
}

function emitHtml(
  id: NodeId,
  nodes: Record<NodeId, Node>,
  doc: Document,
  classOf: Map<NodeId, string>,
  ids: boolean,
): string {
  const node = nodes[id];
  if (!node) return "";
  const tag = node.tag || DEFAULT_TAG[node.type];

  let attr = "";
  for (const [k, v] of Object.entries(domAttrs(node)))
    attr += ` ${k}="${esc(v)}"`;
  const cls = classOf.get(id);
  if (cls) attr += ` class="${cls}"`;
  if (ids) attr += ` data-ol-id="${esc(node.id)}"`;
  // Editor-only marker so the iframe drag script knows where nesting is
  // valid (including into empty containers). Never emitted at publish.
  if (ids && (node.type === "Box" || node.type === "Page"))
    attr += ` data-ol-container=""`;
  // Editor-only lock flag. The iframe inject script treats any element under
  // a `[data-ol-locked]` ancestor as inert (no select/drag/dblclick/right-
  // click). Stored as the magic prop `__locked` so we don't need a new op
  // type — toggled via editSetProps from the Layers panel.
  if (ids && (node.props as { __locked?: boolean })?.__locked === true)
    attr += ` data-ol-locked=""`;

  if (VOID_TAGS.has(tag)) {
    // Unsplash attribution: when an Image carries the unsplashCredit magic
    // prop, wrap it in a <figure>/<figcaption> with photographer + Unsplash
    // links (utm tag per Unsplash TOS). Persisted in the published HTML —
    // not editor-only — because the TOS requires visible attribution.
    if (node.type === "Image") {
      const credit = (node.props as { unsplashCredit?: unknown })
        .unsplashCredit as
        | { author?: unknown; authorUrl?: unknown; photoUrl?: unknown }
        | undefined;
      if (
        credit &&
        typeof credit.author === "string" &&
        typeof credit.authorUrl === "string" &&
        typeof credit.photoUrl === "string"
      ) {
        const utm = "utm_source=openlen&utm_medium=referral";
        const append = (url: string) =>
          url + (url.includes("?") ? "&" : "?") + utm;
        const authorUrl = append(credit.authorUrl);
        const photoUrl = append(credit.photoUrl);
        const caption =
          `<figcaption style="font-size:11px;color:#666;text-align:center;margin-top:4px;line-height:1.4;">` +
          `Photo by <a href="${esc(authorUrl)}" target="_blank" rel="noopener nofollow">${esc(credit.author)}</a>` +
          ` on <a href="${esc(photoUrl)}" target="_blank" rel="noopener nofollow">Unsplash</a>` +
          `</figcaption>`;
        return `<figure style="margin:0;">${`<${tag}${attr}>`}${caption}</figure>`;
      }
    }
    return `<${tag}${attr}>`;
  }

  let inner: string;
  if (node.type === "Text") inner = compileText(node.props);
  else if (node.type === "Embed")
    inner = typeof node.props.html === "string" ? node.props.html : "";
  else if (node.type === "Instance") inner = expandInstance(node, doc, classOf);
  else if (node.type === "Icon")
    inner =
      typeof node.props.name === "string"
        ? (getLucideSvg(node.props.name) ?? "")
        : "";
  else
    inner = node.childIds
      .map((c) => emitHtml(c, nodes, doc, classOf, ids))
      .join("");

  return `<${tag}${attr}>${inner}</${tag}>`;
}

/** Compile a Document to a complete, self-contained static HTML document. */
export function compile(doc: Document, opts: CompileOptions = {}): string {
  const { classOf, css } = planStyles(doc);
  const body = emitHtml(doc.root, doc.nodes, doc, classOf, !!opts.ids);

  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(doc.meta.title)}</title>`,
  ];
  if (doc.meta.description)
    head.push(
      `<meta name="description" content="${esc(doc.meta.description)}">`,
    );
  if (doc.meta.ogImage)
    head.push(`<meta property="og:image" content="${esc(doc.meta.ogImage)}">`);
  if (doc.meta.favicon)
    head.push(`<link rel="icon" href="${esc(doc.meta.favicon)}">`);
  head.push(`<style>${css}</style>`);

  return `<!doctype html><html lang="en"><head>${head.join("")}</head>${body}</html>`;
}
