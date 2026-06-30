/**
 * Shared hero-backdrop target finder for the 3D scene injection system.
 *
 * Used by both:
 *   lib/publish/procedural-3d.ts  (bake path — may mutate the HTML string)
 *   components/workspace-v2/preview-area.tsx (preview path — CSS-only, no mutations)
 *
 * Priority:
 *   1. Element with data-ol-3d-scene attribute
 *   2. First <section> that is a DIRECT child of <body> or <main>
 *   3. First direct element child of <body> not in the skip-list
 *      (script/style/nav/header/link/meta/template)
 *   4. null — caller uses the safe fallback (append before </body>)
 *
 * Design constraints:
 *   - NATIVE-FREE (no DOM, no node:fs) so vitest loads it without .node binaries
 *   - Handles both single- and double-quoted HTML attributes
 *   - Ignores markers/sections inside HTML comments or <script>/<style> bodies
 *     (strips those regions to spaces so character offsets remain valid)
 */

const PLACEHOLDER = "data-ol-3d-scene";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const SKIP_BODY_TAGS = new Set([
  "script", "style", "nav", "header", "link", "meta", "template",
]);

export interface BackdropTarget {
  /** Byte offset of the `<` starting the opening tag in the original string. */
  tagStart: number;
  /** Byte offset past the `>` ending the opening tag. */
  tagEnd: number;
  /** Existing id attribute value, or null. */
  existingId: string | null;
  /** True when this target was found via the data-ol-3d-scene marker (priority 1). */
  isMarker: boolean;
  /**
   * CSS selector that matches this element — use it in the preview <style> so
   * the positioning is applied without mutating the user's HTML string.
   */
  cssSelector: string;
}

// ---------------------------------------------------------------------------
// Helpers (exported so procedural-3d.ts can import instead of duplicating)
// ---------------------------------------------------------------------------

/**
 * Return a copy of the HTML where HTML comment and <script>/<style> body
 * content is replaced with space characters of the SAME byte length, keeping
 * all character offsets intact so tagStart/tagEnd values are valid on the
 * original string.
 */
export function stripInert(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  out = out.replace(
    /<(script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    (m) => " ".repeat(m.length),
  );
  return out;
}

/** Read an attribute value from an opening tag. Handles both quote styles. */
export function getAttr(tag: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}=["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : null;
}

/**
 * Append extra CSS properties to an element's inline style attribute.
 * Handles both single- and double-quoted style values, and the no-attr case.
 * Strips any trailing semicolon from the existing value before joining.
 */
export function mergeStyle(tag: string, extra: string): string {
  const mdq = /\bstyle="([^"]*)"/.exec(tag);
  if (mdq) {
    const existing = mdq[1].replace(/;\s*$/, "");
    return (
      tag.slice(0, mdq.index) +
      `style="${existing};${extra}"` +
      tag.slice(mdq.index + mdq[0].length)
    );
  }
  const msq = /\bstyle='([^']*)'/.exec(tag);
  if (msq) {
    const existing = msq[1].replace(/;\s*$/, "");
    return (
      tag.slice(0, msq.index) +
      `style="${existing};${extra}"` +
      tag.slice(msq.index + msq[0].length)
    );
  }
  const gtIdx = tag.lastIndexOf(">");
  return tag.slice(0, gtIdx) + ` style="${extra}"` + tag.slice(gtIdx);
}

/**
 * Add an id attribute to a tag if it does not already have one.
 * Handles both single- and double-quoted existing id values.
 */
export function withId(tag: string, id: string): string {
  if (/\bid=["']/.test(tag)) return tag;
  const gtIdx = tag.lastIndexOf(">");
  return tag.slice(0, gtIdx) + ` id="${id}"` + tag.slice(gtIdx);
}

// ---------------------------------------------------------------------------
// Finder internals
// ---------------------------------------------------------------------------

/** Walk direct children of parentTag and return the first <section>. */
function firstDirectSection(
  html: string,
  stripped: string,
  parentTag: string,
): BackdropTarget | null {
  const parentRe = new RegExp(`<${parentTag}(?:\\s[^>]*)?>`, "i");
  const parentMatch = parentRe.exec(stripped);
  if (!parentMatch) return null;

  let pos = parentMatch.index + parentMatch[0].length;
  let depth = 0;

  while (pos < stripped.length) {
    const lt = stripped.indexOf("<", pos);
    if (lt === -1) break;

    const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(stripped.slice(lt));
    if (!tagMatch) {
      pos = lt + 1;
      continue;
    }

    const isClose = tagMatch[1] === "/";
    const name = tagMatch[2].toLowerCase();
    const gt = stripped.indexOf(">", lt);
    if (gt === -1) break;

    if (isClose) {
      if (name === parentTag) break;
      depth = Math.max(0, depth - 1);
    } else {
      if (depth === 0 && name === "section") {
        const tagEnd = gt + 1;
        const tag = html.slice(lt, tagEnd);
        const existingId = getAttr(tag, "id");
        const cssSelector = existingId
          ? `#${existingId}`
          : `${parentTag}>section:first-of-type`;
        return { tagStart: lt, tagEnd, existingId, isMarker: false, cssSelector };
      }
      const isSelfClose =
        stripped.slice(lt, gt + 1).endsWith("/>") || VOID_ELEMENTS.has(name);
      if (!isSelfClose) depth++;
    }

    pos = gt + 1;
  }
  return null;
}

/**
 * Walk direct children of <body> and return the first element that is NOT in
 * the skip-list and NOT a void element.
 */
function firstBodyChild(
  html: string,
  stripped: string,
): BackdropTarget | null {
  const bodyMatch = /<body(?:\s[^>]*)?>/.exec(stripped);
  if (!bodyMatch) return null;

  let pos = bodyMatch.index + bodyMatch[0].length;
  let childIndex = 0;

  while (pos < stripped.length) {
    while (pos < stripped.length && /\s/.test(stripped[pos])) pos++;
    if (pos >= stripped.length || stripped[pos] !== "<") break;

    const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(stripped.slice(pos));
    if (!tagMatch) break;

    const isClose = tagMatch[1] === "/";
    const name = tagMatch[2].toLowerCase();

    if (isClose) break; // </body>
    childIndex++;

    const gt = stripped.indexOf(">", pos);
    if (gt === -1) break;

    const isSelf =
      stripped.slice(pos, gt + 1).endsWith("/>") || VOID_ELEMENTS.has(name);

    if (!SKIP_BODY_TAGS.has(name) && !VOID_ELEMENTS.has(name)) {
      const tagEnd = gt + 1;
      const tag = html.slice(pos, tagEnd);
      const existingId = getAttr(tag, "id");
      // nth-child counts ALL element siblings (incl. skipped nav/header), so the
      // preview's <style> selector resolves to the SAME element the bake mutates.
      const cssSelector = existingId
        ? `#${existingId}`
        : `body>:nth-child(${childIndex})`;
      return { tagStart: pos, tagEnd, existingId, isMarker: false, cssSelector };
    }

    // Skip this element's entire subtree to look at the next sibling.
    if (isSelf) {
      pos = gt + 1;
    } else {
      let depth = 1;
      let sp = gt + 1;
      while (sp < stripped.length && depth > 0) {
        const nlt = stripped.indexOf("<", sp);
        if (nlt === -1) break;
        const ntm = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(stripped.slice(nlt));
        if (!ntm) { sp = nlt + 1; continue; }
        const ngt = stripped.indexOf(">", nlt);
        if (ngt === -1) break;
        const nc = ntm[1] === "/";
        const nn = ntm[2].toLowerCase();
        const nSelf =
          stripped.slice(nlt, ngt + 1).endsWith("/>") || VOID_ELEMENTS.has(nn);
        if (nn === name) {
          if (nc) depth--;
          else if (!nSelf) depth++;
        }
        sp = ngt + 1;
      }
      pos = sp;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the element that will host the hero backdrop.
 *
 * Returns a `BackdropTarget` describing the tag's string offsets, its id (if
 * any), whether it is the data-ol-3d-scene marker (priority 1), and a CSS
 * selector for the preview's `<style>` injection.
 *
 * Returns null when no suitable host is found — callers should append the
 * backdrop before `</body>` as a fixed full-bleed fallback with z-index:-1.
 */
export function findBackdropTarget(html: string): BackdropTarget | null {
  const stripped = stripInert(html);

  // Priority 1: element carrying data-ol-3d-scene
  if (stripped.includes(PLACEHOLDER)) {
    const markerIdx = stripped.indexOf(PLACEHOLDER);
    const tagStart = stripped.lastIndexOf("<", markerIdx);
    if (tagStart !== -1) {
      const gt = stripped.indexOf(">", tagStart);
      if (gt !== -1) {
        const tagEnd = gt + 1;
        const tag = html.slice(tagStart, tagEnd);
        const existingId = getAttr(tag, "id");
        const cssSelector = existingId ? `#${existingId}` : "[data-ol-3d-scene]";
        return { tagStart, tagEnd, existingId, isMarker: true, cssSelector };
      }
    }
  }

  // Priority 2: first <section> that is a direct child of <body> or <main>
  const bodySection = firstDirectSection(html, stripped, "body");
  const mainSection = firstDirectSection(html, stripped, "main");

  if (bodySection && mainSection) {
    return bodySection.tagStart <= mainSection.tagStart ? bodySection : mainSection;
  }
  if (bodySection) return bodySection;
  if (mainSection) return mainSection;

  // Priority 3: first direct element child of <body> not in the skip-list
  return firstBodyChild(html, stripped);
}
