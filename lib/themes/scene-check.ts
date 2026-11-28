// THE SCENE'S GATE. A theme's scene is an SVG the workspace paints in an <img> behind the glass panels (and the
// route that serves it also hands it out as a file of its own). It is written by Len — or by anyone who sends a
// project — so before it is kept this decides, from the text alone, whether it may be: no script, no event handler,
// no <foreignObject>, no SMIL, nothing that points outside the document, no DTD, a root that covers the window.
//
// It works on text, not on a parser: that is what a browser does with an <img> too (it runs nothing and fetches
// nothing), and what is looked for here are marks. The refusals that look for a mark ANYWHERE in the text (a script,
// an href, a url(), an @import) are on purpose stricter than a parse: a hit inside a comment or a <text> is a false
// positive that costs a clear message, never a hole. For the same reason nothing is allowed to HIDE a mark: a numeric
// character reference (`&#114;`) or a CSS escape (`\75`) could spell `url(` or `@import` where the text does not
// show it, so neither is taken; nor is a `<style>` with markup in its text (`ur<!---->l(`), which a browser joins
// into one string and a scan of the text does not. Only the event handlers, namespaces, `src` and SMIL look at real
// tags and attributes, because a word like `once =` in a caption must not read as one. Every pass is linear in the
// size of the scene (no regular expression that backtracks on a long run), because the scene is up to a megabyte and
// it is somebody else's.
//
// It also counts what the scene costs to paint. Claude Code's own theme scenes were measured (spec §10.1) on
// Jesús's laptop, an i5-11400H with an Intel UHD, behind the workspace: night-reef ran at 44–46 fps and honu-lagoon
// at 56–58. The server cannot measure that — its Chromium paints by software — so the count is calibrated on those
// two, and the protection that really works is the client's (a scene that cannot hold 50 fps is shown still).
//
// Client-safe: no server imports.

export const SCENE_MAX_BYTES = 1_048_576;
export const REDUCED_MOTION_RULE = "@media (prefers-reduced-motion: reduce){*{animation:none!important}}";

/** The unconditional twin of the rule above: what `?still=1` serves. */
const STILL_RULE = "*{animation:none!important}";

/**
 * The scene's cost, counted from its text. `elements` is the opening tags; `animated` is the elements that something
 * animates: those a CSS rule with an `animation` reaches, or that carry one in their `style`. (SMIL is refused, so
 * CSS is the only animation there is to count.)
 */
export interface SceneCost {
  elements: number;
  animated: number;
  heavy: boolean;
}

export interface SceneProblem {
  code: string;
  file: string;
  detail?: string;
}

export type SceneCheck =
  | { ok: true; svg: string; addedReducedMotion: boolean; cost: SceneCost }
  | { ok: false; problem: SceneProblem };

// ---------------------------------------------------------------------------------------------------------------
// Tokenizing: one linear pass that finds the opening tags and their attributes.

interface SceneAttr {
  name: string;
  value: string;
}

interface SceneTag {
  /** As written, with its prefix if it has one. */
  name: string;
  attrs: SceneAttr[];
  /** Index of the `<`. */
  start: number;
  /** Index just after the `>`. */
  end: number;
  selfClosing: boolean;
}

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
// Anything but what cannot begin a tag name: a `/` (a closing tag), `!`, `?`, a space, a `>`, or the end of the text.
// Wider than XML's own name start on purpose: an `<é onclick="…"/>` or a `<:g …/>` a parser might take as an element
// is looked at here as one, and refused if it carries what an element may not.
const isNameStart = (c: number) =>
  !Number.isNaN(c) && c !== 47 /* / */ && c !== 33 /* ! */ && c !== 63 /* ? */ && c !== 62 /* > */ && !isSpace(c);

/**
 * The opening tags of the document, in order, skipping comments, CDATA, processing instructions and declarations.
 * Quote-aware, so a `>` inside an attribute does not end a tag. A tag that never ends (which an XML parser would
 * refuse as a whole) stops the pass.
 */
function scanTags(svg: string): SceneTag[] {
  const tags: SceneTag[] = [];
  const n = svg.length;
  let i = 0;
  while (i < n) {
    const lt = svg.indexOf("<", i);
    if (lt < 0) break;

    if (svg.startsWith("<!--", lt)) {
      const e = svg.indexOf("-->", lt + 4);
      if (e < 0) break;
      i = e + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", lt)) {
      const e = svg.indexOf("]]>", lt + 9);
      if (e < 0) break;
      i = e + 3;
      continue;
    }
    if (svg.startsWith("<?", lt)) {
      const e = svg.indexOf("?>", lt + 2);
      if (e < 0) break;
      i = e + 2;
      continue;
    }
    if (svg.startsWith("<!", lt)) {
      const e = svg.indexOf(">", lt + 2);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    if (!isNameStart(svg.charCodeAt(lt + 1))) {
      // `</x>`, a lone `<`.
      i = lt + 1;
      continue;
    }

    let j = lt + 1;
    while (j < n) {
      const c = svg.charCodeAt(j);
      if (isSpace(c) || c === 47 /* / */ || c === 62 /* > */) break;
      j++;
    }
    const name = svg.slice(lt + 1, j);
    const attrs: SceneAttr[] = [];
    let end = -1;
    let selfClosing = false;

    while (j < n) {
      while (j < n && isSpace(svg.charCodeAt(j))) j++;
      if (j >= n) break;
      const c = svg.charCodeAt(j);
      if (c === 62) {
        end = j + 1;
        break;
      }
      if (c === 47) {
        if (svg.charCodeAt(j + 1) === 62) {
          selfClosing = true;
          end = j + 2;
          break;
        }
        j++;
        continue;
      }

      const nameStart = j;
      while (j < n) {
        const d = svg.charCodeAt(j);
        if (isSpace(d) || d === 61 /* = */ || d === 47 || d === 62) break;
        j++;
      }
      const attrName = svg.slice(nameStart, j);
      while (j < n && isSpace(svg.charCodeAt(j))) j++;
      let value = "";
      if (svg.charCodeAt(j) === 61) {
        j++;
        while (j < n && isSpace(svg.charCodeAt(j))) j++;
        const q = svg[j];
        if (q === '"' || q === "'") {
          const e = svg.indexOf(q, j + 1);
          if (e < 0) {
            j = n;
            break;
          }
          value = svg.slice(j + 1, e);
          j = e + 1;
        } else {
          const valueStart = j;
          while (j < n && !isSpace(svg.charCodeAt(j)) && svg.charCodeAt(j) !== 62) j++;
          value = svg.slice(valueStart, j);
        }
      }
      if (attrName !== "") attrs.push({ name: attrName, value });
    }

    if (end < 0) break;
    tags.push({ name, attrs, start: lt, end, selfClosing });
    i = end;
  }
  return tags;
}

const localName = (name: string) => name.slice(name.lastIndexOf(":") + 1);

function attrOf(tag: SceneTag, name: string): string | undefined {
  for (const a of tag.attrs) if (a.name === name) return a.value;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// CSS: which elements does an animation reach?

/** CSS without its comments. */
function cleanCss(css: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const open = css.indexOf("/*", pos);
    if (open < 0) {
      out += css.slice(pos);
      break;
    }
    out += css.slice(pos, open);
    const close = css.indexOf("*/", open + 2);
    if (close < 0) break;
    pos = close + 2;
  }
  return out;
}

/** The index of the `}` that closes the `{` at `open` (the end of the text if it never closes). Skips strings. */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const e = css.indexOf(ch, i + 1);
      if (e < 0) return css.length;
      i = e;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** True when a declaration list starts an animation: `animation` or `animation-name` with something other than `none`. */
function declaresAnimation(body: string): boolean {
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase().replace(/^-(webkit|moz|ms|o)-/, "");
    if (property !== "animation" && property !== "animation-name") continue;
    const value = declaration.slice(colon + 1).replace(/!\s*important/i, "").trim().toLowerCase();
    if (value !== "" && value !== "none") return true;
  }
  return false;
}

const MAX_AT_RULE_DEPTH = 4;

/** The selectors of every rule that starts an animation (`@keyframes` and the reduced-motion media are left out). */
function animatingSelectors(css: string, depth = 0): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    const close = closingBrace(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|layer|container)\b/i.test(prelude)) {
        // A rule that only applies to someone who asked for less motion is not the scene's own animation. (The
        // `no-preference` half, and a `not`, are.)
        const stopsMotion =
          /prefers-reduced-motion(?!\s*:\s*no-preference)/i.test(prelude) && !/^@media\s+not\b/i.test(prelude);
        if (!stopsMotion && depth < MAX_AT_RULE_DEPTH) out.push(...animatingSelectors(body, depth + 1));
      }
    } else if (declaresAnimation(body)) {
      for (const selector of prelude.split(",")) if (selector.trim() !== "") out.push(selector.trim());
    }
    i = close + 1;
  }
  return out;
}

interface Compound {
  tag?: string;
  classes: string[];
  id?: string;
}

const isIdentChar = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c > 127;

/**
 * The last compound selector of a selector (`.a .b g:first-child` → `g`): what the element at the end of the path
 * has to be. A combinator's ancestors are not checked (so a descendant rule reaches every element that fits its end,
 * which can only over-count), nor are attribute selectors or pseudo-classes.
 */
function lastCompound(selector: string): Compound {
  let depth = 0;
  let start = 0;
  for (let k = 0; k < selector.length; k++) {
    const ch = selector[k];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 0 && (isSpace(selector.charCodeAt(k)) || ch === ">" || ch === "+" || ch === "~")) start = k + 1;
  }
  const s = selector.slice(start);
  const compound: Compound = { classes: [] };
  const readIdent = (from: number) => {
    let to = from;
    while (to < s.length && isIdentChar(s.charCodeAt(to))) to++;
    return to;
  };

  let k = 0;
  if (s[0] === "*") k = 1;
  else if (isIdentChar(s.charCodeAt(0))) {
    const to = readIdent(0);
    compound.tag = localName(s.slice(0, to));
    k = to;
  }
  while (k < s.length) {
    const ch = s[k];
    if (ch === ".") {
      const to = readIdent(k + 1);
      compound.classes.push(s.slice(k + 1, to));
      k = to;
    } else if (ch === "#") {
      const to = readIdent(k + 1);
      compound.id = s.slice(k + 1, to);
      k = to;
    } else if (ch === "[") {
      const to = s.indexOf("]", k);
      k = to < 0 ? s.length : to + 1;
    } else if (ch === ":") {
      while (s[k] === ":") k++;
      k = readIdent(k);
      if (s[k] === "(") {
        let d = 0;
        for (; k < s.length; k++) {
          if (s[k] === "(") d++;
          else if (s[k] === ")" && --d === 0) {
            k++;
            break;
          }
        }
      }
    } else k++;
  }
  return compound;
}

/** The most pairs of (element, selector) looked at. Past it the scene is counted as animated throughout. */
const MATCH_WORK_CAP = 20_000_000;

/**
 * The text of every `<style>`, as written: from after its tag to the closing tag that follows. A browser reads the
 * text and CDATA children of a style as ONE string, so a comment, an instruction, a CDATA section or an element in
 * the middle of a word (`ur<!---->l(`) does not split it there: the scene would hide the word from every scan of the
 * text and still have it. So a style may hold no markup at all, and `markup` says that one does.
 */
function styleBlocks(tags: SceneTag[], svg: string): { blocks: string[]; markup: boolean } {
  const blocks: string[] = [];
  for (const tag of tags) {
    if (localName(tag.name).toLowerCase() !== "style" || tag.selfClosing) continue;
    const lt = svg.indexOf("<", tag.end);
    if (lt >= 0 && !svg.startsWith("</", lt)) return { blocks, markup: true };
    blocks.push(svg.slice(tag.end, lt < 0 ? svg.length : lt));
  }
  return { blocks, markup: false };
}

/** The CSS of every `<style>`, comments gone. */
const styleText = (blocks: string[]) => blocks.map((block) => cleanCss(block) + "\n").join("");

function countAnimated(tags: SceneTag[], css: string): number {
  const seen = new Set<string>();
  const compounds: Compound[] = [];
  for (const selector of animatingSelectors(css)) {
    if (seen.has(selector)) continue;
    seen.add(selector);
    compounds.push(lastCompound(selector));
  }

  if (tags.length * compounds.length > MATCH_WORK_CAP) return tags.length;

  let animated = 0;
  for (const tag of tags) {
    const local = localName(tag.name);
    const style = attrOf(tag, "style");
    let hit = style !== undefined && declaresAnimation(style);
    if (!hit && compounds.length > 0) {
      const classes = (attrOf(tag, "class") ?? "").split(/\s+/).filter(Boolean);
      const id = attrOf(tag, "id");
      hit = compounds.some(
        (c) =>
          (c.tag === undefined || c.tag === local) &&
          (c.id === undefined || c.id === id) &&
          c.classes.every((cls) => classes.includes(cls)),
      );
    }
    if (hit) animated++;
  }
  return animated;
}

// ---------------------------------------------------------------------------------------------------------------
// The cost.

/**
 * `heavy` is where the scene stops being light, drawn between the two scenes that were measured (spec §10.1):
 *
 *   honu-lagoon  508 elements, 42 animated · 56–58 fps on the laptop → light
 *   night-reef   797 elements, 90 animated · 44–46 fps on the laptop → heavy
 *
 * An <img> SVG is repainted whole on every frame something in it moves, so what costs is how much there is to repaint
 * while something moves: a scene with nothing animated is painted once and is never heavy, however big. Two measured
 * scenes fix a line, not a model: it is drawn on the elements (both counts grow together in the two) and sits at the
 * midpoint between them, rounded.
 *
 * ⚠️ Measured again on 27/11 on the same laptop, IDLE: honu-lagoon 60, night-reef 60, koi-mosaic 60, dither-dunes 57 and
 * dither-dunes-night 57 fps — night-reef's 44 was the laptop under load. What decides the frame rate is the machine's
 * load, not the element count, so this line is NOT a protection: it is information (Len reads `heavy` in what `publish`
 * says, and the layer may start a heavy scene still). The protection is the client's own guard, which counts the frames
 * on the person's machine and stops the scene when they fall (`components/workspace-v2/theme/motion-guard.ts`). Claude
 * Code does the same: `claude plugin validate` only PRINTS a shader's cost, it refuses nothing for it. So the threshold
 * stays where it is, and is not to be tuned on more measurements.
 */
const HEAVY_MIN_ELEMENTS = 650;

function costOf(tags: SceneTag[], css: string): SceneCost {
  const elements = tags.length;
  const animated = countAnimated(tags, css);
  return { elements, animated, heavy: animated > 0 && elements >= HEAVY_MIN_ELEMENTS };
}

// ---------------------------------------------------------------------------------------------------------------
// The checks.

const DETAIL_MAX = 80;
const clip = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s);

const DECLARATION = /<!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i;
const SCRIPT = /<(?:[\w.-]+:)?script(?![\w:.-])/i;
const FOREIGN_OBJECT = /<(?:[\w.-]+:)?foreignObject(?![\w:.-])/i;
const HREF = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
const URL_CALL = /url\(\s*["']?\s*([^\s)])?/gi;
// The other CSS functions that load a picture. Nothing in a scene needs them.
const IMAGE_FUNCTION = /(?:image-set|image|src)\(/i;
const IMPORT = /@import/i;
// A reduced-motion block that stops ALL animation, written with any spacing: a `@media (prefers-reduced-motion: reduce)`
// block with a `*` rule that says `animation: none` — alone or beside other declarations, and before or after other
// rules (koi-mosaic and dither-dunes also hide details at rest in the same block). A rule that stops only one class
// stops less than the gate's, so it is not taken for it. Only used to say whether the scene had it (see
// `addedReducedMotion`, a report): the gate puts its own either way.
const REDUCED_MOTION_PRESENT =
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{(?:[^{}]*\{[^{}]*\})*?\s*\*\s*\{[^{}]*\banimation\s*:\s*none\b/i;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
// SMIL animates from inside the document, and `animation:none` does not touch it: the reduced-motion rule and the
// still scene would stop nothing. It can also set an `href` (a `<set attributeName="href" to="javascript:…">`).
const SMIL_ELEMENTS = new Set(["animate", "animatetransform", "animatemotion", "set", "discard"]);

function problem(code: string, file: string, detail?: string): { ok: false; problem: SceneProblem } {
  return { ok: false, problem: detail === undefined ? { code, file } : { code, file, detail } };
}

/** The first thing in the text that reaches outside the document, or null. */
function externalRef(svg: string): string | null {
  for (const m of svg.matchAll(HREF)) {
    const value = m[1] ?? m[2] ?? m[3] ?? "";
    if (!value.startsWith("#")) return clip(m[0]);
  }
  for (const m of svg.matchAll(URL_CALL)) {
    if (m[1] !== "#") {
      const close = svg.indexOf(")", m.index);
      return clip(svg.slice(m.index, close < 0 ? m.index + DETAIL_MAX : close + 1));
    }
  }
  const picture = IMAGE_FUNCTION.exec(svg);
  if (picture) return picture[0];
  if (IMPORT.test(svg)) return "@import";
  return null;
}

// `\d+(\.\d*)?` and not `\d+\.?\d*`: the second can split a long run of digits in as many ways as it is long.
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const NUMBER_MAX_LENGTH = 40;

function validViewBox(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4 || !parts.every((p) => p.length <= NUMBER_MAX_LENGTH && NUMBER.test(p))) return false;
  return Number(parts[2]) > 0 && Number(parts[3]) > 0;
}

/**
 * Adds `rule` as a `<style>` of its own, first thing inside the root. Not appended to the scene's own: that one is
 * somebody's CSS, and a brace left open or a comment never closed in it would swallow a rule written after it — and
 * this rule is the guarantee, so it stands where nothing of theirs can reach it.
 */
function withRule(svg: string, root: SceneTag | undefined, rule: string): string {
  if (!root) return svg;
  const style = `<style>${rule}</style>`;
  if (root.selfClosing) {
    const opened = svg.slice(root.start, root.end - 2).trimEnd() + ">";
    return svg.slice(0, root.start) + opened + style + "</svg>" + svg.slice(root.end);
  }
  return svg.slice(0, root.end) + style + svg.slice(root.end);
}

export function checkScene(svg: string, file: string): SceneCheck {
  // A string has at least as many bytes as it has UTF-16 units: one that is longer than the limit is over it, and a
  // huge one is not copied just to be counted.
  const tooBig = svg.length > SCENE_MAX_BYTES || new TextEncoder().encode(svg).length > SCENE_MAX_BYTES;
  if (tooBig) return problem("too_big", file, `more than ${SCENE_MAX_BYTES} bytes`);

  const declaration = DECLARATION.exec(svg);
  if (declaration) return problem("doctype", file, declaration[0]);
  // A numeric character reference can spell a mark the text does not show (`u&#114;l(`, `@imp&#111;rt`).
  if (svg.includes("&#")) return problem("char_reference", file);
  if (SCRIPT.test(svg)) return problem("script", file);
  if (FOREIGN_OBJECT.test(svg)) return problem("foreign_object", file);

  const tags = scanTags(svg);
  const root = tags[0];
  if (!root || root.name !== "svg") return problem("not_svg", file, root ? root.name : "no root element");
  if (attrOf(root, "xmlns") !== SVG_NAMESPACE) return problem("not_svg", file, "xmlns");

  for (const tag of tags) {
    if (SMIL_ELEMENTS.has(localName(tag.name).toLowerCase())) return problem("smil", file, clip(tag.name));
    for (const attr of tag.attrs) {
      if (/^on[a-z]/i.test(attr.name)) return problem("event_handler", file, clip(attr.name));
      // Only the two namespaces of an SVG: a foreign one is how an `<iframe>` or an `<img>` of XHTML gets in.
      const declaresNamespace = attr.name === "xmlns" || attr.name.startsWith("xmlns:");
      if (declaresNamespace && attr.value !== SVG_NAMESPACE && attr.value !== XLINK_NAMESPACE) {
        return problem("foreign_namespace", file, clip(`${attr.name}="${attr.value}"`));
      }
      // Nothing in a scene has a `src`: it is how an <img> or an <iframe> loads what it names.
      if (localName(attr.name).toLowerCase() === "src") {
        return problem("external_ref", file, clip(`${attr.name}="${attr.value}"`));
      }
      // Every attribute is CSS to a browser when it is a presentation one (`fill`, `filter`, `style`…).
      if (attr.value.includes("\\")) return problem("css_escape", file, clip(attr.name));
    }
  }
  const { blocks, markup } = styleBlocks(tags, svg);
  if (markup) return problem("style_markup", file);
  if (blocks.some((block) => block.includes("\\"))) return problem("css_escape", file, "style");

  const external = externalRef(svg);
  if (external !== null) return problem("external_ref", file, external);

  const viewBox = attrOf(root, "viewBox");
  if (!validViewBox(viewBox)) return problem("no_viewbox", file, viewBox === undefined ? "missing" : clip(viewBox));
  const aspect = attrOf(root, "preserveAspectRatio");
  if (aspect === undefined || !/\bslice\b/.test(aspect)) {
    return problem("not_slice", file, aspect === undefined ? "missing" : clip(aspect));
  }

  return {
    ok: true,
    // The gate's own rule goes in whatever the scene says: a rule the author wrote can sit in a comment or a nested
    // `@media` and stop nothing, so nothing of theirs is taken as the guarantee.
    svg: withRule(svg, root, REDUCED_MOTION_RULE),
    // Only a report of whether the author wrote it too.
    addedReducedMotion: !REDUCED_MOTION_PRESENT.test(svg),
    cost: costOf(tags, styleText(blocks)),
  };
}

/**
 * The same scene, standing still: what `?still=1` serves to someone who asked for less motion or whose machine
 * cannot hold the frames. The rule is unconditional here (no `@media`), so it stops CSS animation whatever the
 * browser says. Meant for a scene that already passed `checkScene`. It is always put in, never looked for: a copy of
 * it in a comment, or inside a media query, would be taken for this one and stop nothing.
 */
export function stillScene(svg: string): string {
  const root = scanTags(svg)[0];
  return root && root.name === "svg" ? withRule(svg, root, STILL_RULE) : svg;
}
