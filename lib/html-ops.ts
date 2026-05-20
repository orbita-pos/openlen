// HTML editing operations — ID-tagged DOM addressing for the Chat tab's
// patch protocol. Server-side we inject a `data-op-id` attribute on every
// element of the project HTML before sending it to Kimi K2.6. The model
// emits ops keyed on those IDs (e.g. `target="a4"`); the applier looks
// them up via CSS selector and mutates the DOM. After applying, we strip
// the IDs so persisted / published HTML stays clean.
//
// Why IDs and not exact-string-match (SEARCH/REPLACE) anchors:
//   - Anchor by attribute = ~10 tokens; anchor by outerHTML = 200-1000+
//   - Zero ambiguity — every element has a unique ID, querySelector is O(1)
//   - The model addresses "this h1" by id, no risk of editing the wrong
//     duplicate (HTML has many repeated structures like <li>, <div.card>)
//
// Trade-off accepted: cheerio adds ~150KB to the server bundle but it's
// already in the project's deps. No runtime cost per request beyond the
// parse/serialize round trip (~20-50ms for a 50KB template).

import * as cheerio from "cheerio";

const OP_ID_ATTR = "data-op-id";
// Tags we skip when tagging — they don't have meaningful "edit me" semantics
// and tagging them just wastes input tokens. The model never references
// these.
const SKIP_TAGS = new Set([
  "html",
  "head",
  "meta",
  "title",
  "link",
  "script",
  "style",
  "noscript",
  "br",
  "hr",
]);

export interface TaggedHtmlResult {
  taggedHtml: string;
  /** How many elements got an ID. Used to enforce a sanity cap in
   *  oversized docs. */
  taggedCount: number;
}

/** Inject `data-op-id` on every "addressable" element. IDs are base36
 *  monotonic strings (a, b, c, ..., z, 10, 11, ...) to keep them as short
 *  as possible in the prompt. */
export function tagWithOpIds(html: string): TaggedHtmlResult {
  if (!html || html.trim().length === 0) {
    return { taggedHtml: html, taggedCount: 0 };
  }
  const $ = cheerio.load(html, { xmlMode: false });
  let counter = 0;
  const nextId = (): string => {
    const id = counter.toString(36);
    counter += 1;
    return id;
  };

  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    const tagName = (el as { name?: string }).name;
    if (!tagName) return;
    if (SKIP_TAGS.has(tagName.toLowerCase())) return;
    // Don't double-tag if some external pipeline already added one — keep
    // their existing ID stable.
    const existing = $(el).attr(OP_ID_ATTR);
    if (existing) return;
    $(el).attr(OP_ID_ATTR, nextId());
  });

  return { taggedHtml: $.html(), taggedCount: counter };
}

/** Resolve a CSS-selector breadcrumb (from the iframe's section-select
 *  script) against an already-tagged document, returning the matched
 *  element's `data-op-id`. Used by the Chat AI route to turn a click
 *  gesture into a hard pin for Kimi.
 *
 *  Returns null when the path is empty, the document doesn't parse, or
 *  the selector doesn't match anything. The caller falls back to the
 *  textual hint in that case — so a miss never breaks the request. */
export function resolveOpIdByPath(
  taggedHtml: string,
  path: string,
): string | null {
  if (!path || path.trim().length === 0) return null;
  if (!taggedHtml || taggedHtml.trim().length === 0) return null;
  let $;
  try {
    $ = cheerio.load(taggedHtml, { xmlMode: false });
  } catch {
    return null;
  }
  // The client builds paths starting at the first descendant of <body>;
  // anchoring here makes the selector unambiguous in docs that repeat
  // structures (e.g. <main><section>… inside <body><main>).
  const fullPath = path.startsWith("body") ? path : `body > ${path}`;
  let found;
  try {
    found = $(fullPath).first();
  } catch {
    return null;
  }
  if (!found || found.length === 0) return null;
  const opId = found.attr(OP_ID_ATTR);
  return typeof opId === "string" && opId.length > 0 ? opId : null;
}

// Semantic containers we consider "section-like" — the body's direct
// child that wraps a logical region. Walking up from a pin until we hit
// one of these gives us a scoped slice that's tight but still
// self-contained context for Kimi.
const SECTION_TAGS = new Set([
  "section",
  "header",
  "footer",
  "main",
  "aside",
  "article",
  "nav",
]);

export interface ScopedView {
  /** The enclosing semantic container's outerHtml, still carrying op-ids
   *  so Kimi can address its descendants. */
  scopedHtml: string;
  /** The container's own op-id — Kimi uses this to delete/replace the
   *  whole scoped block, or insert siblings before/after it. */
  containerOpId: string;
  /** One-line-per-top-level-section summary of the whole document so the
   *  model knows what else lives on the page even though we didn't ship
   *  the full HTML. Each line: `- [opId] <tag> "first-heading-or-hint"`. */
  outline: string;
  /** True when the pin already addresses a body-level container (no
   *  walking needed). Cosmetic — useful when wording the prompt. */
  pinIsContainer: boolean;
}

/** Given a tagged document and a pin (an op-id known to exist), return a
 *  scoped view: the pin's enclosing semantic container + an outline of all
 *  other top-level sections. Lets the route send Kimi a tiny payload
 *  instead of the entire taggedHtml.
 *
 *  Returns null when:
 *    - the document doesn't parse,
 *    - the pin isn't found,
 *    - there's no <body> (malformed doc).
 *
 *  Caller falls back to sending the full taggedHtml in that case. */
export function buildScopedView(
  taggedHtml: string,
  pinnedOpId: string,
): ScopedView | null {
  if (!taggedHtml || !pinnedOpId) return null;
  let $;
  try {
    $ = cheerio.load(taggedHtml, { xmlMode: false });
  } catch {
    return null;
  }

  const pinSelector = `[${OP_ID_ATTR}="${pinnedOpId.replace(/"/g, '\\"')}"]`;
  const pinned = $(pinSelector).first();
  if (pinned.length === 0) return null;

  const body = $("body").first();
  if (body.length === 0) return null;

  // Walk up from the pin to find a semantic container. If we hit body
  // first, use the pin's nearest body-level ancestor.
  let container = pinned;
  let pinIsContainer = false;
  for (;;) {
    const tag = (container.get(0) as { name?: string } | undefined)?.name?.toLowerCase();
    if (tag && SECTION_TAGS.has(tag)) {
      pinIsContainer = container.is(pinSelector);
      break;
    }
    const parent = container.parent();
    if (parent.length === 0 || parent.is("body") || parent.is("html")) {
      // No semantic ancestor — fall back to whichever direct body child
      // contains the pin. If the pin is already a direct child of body,
      // use itself.
      const directChild = pinned.closest("body > *");
      if (directChild.length > 0) {
        container = directChild;
        pinIsContainer = container.is(pinSelector);
      }
      break;
    }
    container = parent;
  }

  const containerEl = container.get(0) as { name?: string } | undefined;
  const containerOpId = container.attr(OP_ID_ATTR);
  if (!containerEl || !containerOpId) return null;

  // Capture the container's outerHtml. cheerio's $.html(selection) gives
  // outerHtml semantics.
  const scopedHtml = $.html(container);

  // Build the outline from body's direct children. Each line tags the
  // top-level section so Kimi knows what op-ids are still addressable
  // outside the scoped slice (insert_before/after a sibling, delete a
  // sibling, etc.).
  const outlineLines: string[] = [];
  body.children().each((_, el) => {
    if (el.type !== "tag") return;
    const $el = $(el);
    const tag = (el as { name?: string }).name?.toLowerCase();
    if (!tag) return;
    if (SKIP_TAGS.has(tag)) return;
    const opId = $el.attr(OP_ID_ATTR);
    if (!opId) return;
    const heading = $el.find("h1, h2, h3").first();
    let hint = "";
    if (heading.length > 0) {
      hint = heading.text().trim().replace(/\s+/g, " ").slice(0, 60);
    } else {
      // Fallback hint: first non-empty text content, or className/id.
      const text = $el.text().trim().replace(/\s+/g, " ").slice(0, 60);
      if (text) hint = text;
      else hint = ($el.attr("id") || $el.attr("class") || "").slice(0, 60);
    }
    const isScoped = opId === containerOpId ? " (SCOPED)" : "";
    outlineLines.push(
      `- [${opId}] <${tag}>${hint ? ` "${hint}"` : ""}${isScoped}`,
    );
  });

  return {
    scopedHtml,
    containerOpId,
    outline: outlineLines.join("\n"),
    pinIsContainer,
  };
}

/** Strip `data-op-id` attributes from the HTML. Always called before
 *  persisting / publishing so the IDs never leak to disk or to the user's
 *  subdomain. */
export function stripOpIds(html: string): string {
  if (!html) return html;
  // Cheap regex strip — avoids a parse+serialize round trip on a doc that
  // may already be ~60KB. The attribute value is `[a-z0-9]+` so the
  // regex is bounded and safe.
  return html.replace(/\s*data-op-id="[a-z0-9]+"/gi, "");
}

export type OpType =
  | "replace"
  | "insert_before"
  | "insert_after"
  | "delete";

export interface Op {
  type: OpType;
  target: string;
  /** New HTML for replace / insert_*; ignored for delete. */
  newHtml?: string;
}

export interface OpParseResult {
  ops: Op[];
  /** Parser-level problems (malformed XML, unknown op types, missing
   *  attributes). These short-circuit applyOps. */
  errors: string[];
}

const OPS_BLOCK_RE = /<edits[^>]*>([\s\S]*?)<\/edits>/i;
const EDIT_BLOCK_RE = /<edit\b([^>]*)>([\s\S]*?)<\/edit>/gi;
const ATTR_RE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
const NEW_INNER_RE = /<new[^>]*>([\s\S]*?)<\/new>/i;
// Self-closing <edit op="delete" target="x" /> form. Same outer regex
// can't catch self-closing because we require </edit>; we hunt these
// separately.
const SELF_CLOSING_EDIT_RE = /<edit\b([^>]*)\/>/gi;

/** Parse the `<edits>...</edits>` envelope Kimi emits in ops mode. Tolerant
 *  to surrounding whitespace + markdown fences (already stripped by caller).
 *  Returns ops in emission order. */
export function parseOps(rawHtml: string): OpParseResult {
  const errors: string[] = [];
  if (!rawHtml || rawHtml.trim().length === 0) {
    return { ops: [], errors: ["Empty ops body"] };
  }

  const blockMatch = OPS_BLOCK_RE.exec(rawHtml);
  if (!blockMatch) {
    return {
      ops: [],
      errors: [
        "No <edits>…</edits> block found in the response. The model may have emitted a full document instead — caller should fall back to rewrite mode.",
      ],
    };
  }

  const body = blockMatch[1];
  const ops: Op[] = [];

  // Self-closing first (delete ops, mostly).
  for (const m of body.matchAll(SELF_CLOSING_EDIT_RE)) {
    const attrs = parseAttrs(m[1]);
    const op = attrs.op as OpType | undefined;
    const target = attrs.target;
    if (!op || !target) {
      errors.push("<edit/> missing op or target attribute");
      continue;
    }
    if (!isValidOpType(op)) {
      errors.push(`Unknown op type "${op}"`);
      continue;
    }
    if (op !== "delete") {
      errors.push(
        `Op "${op}" requires <new>...</new> content; can't be self-closing.`,
      );
      continue;
    }
    ops.push({ type: op, target });
  }

  // Open-close form.
  for (const m of body.matchAll(EDIT_BLOCK_RE)) {
    const attrs = parseAttrs(m[1]);
    const op = attrs.op as OpType | undefined;
    const target = attrs.target;
    if (!op || !target) {
      errors.push("<edit> missing op or target attribute");
      continue;
    }
    if (!isValidOpType(op)) {
      errors.push(`Unknown op type "${op}"`);
      continue;
    }
    if (op === "delete") {
      ops.push({ type: op, target });
      continue;
    }
    // Accept either form:
    //   <edit op="replace" target="x"><new>...</new></edit>  (explicit)
    //   <edit op="replace" target="x">...</edit>             (natural — what Kimi prefers)
    // If a <new> wrapper exists, use its inner content; otherwise use the
    // entire body of <edit> as newHtml.
    const newMatch = NEW_INNER_RE.exec(m[2]);
    const rawNew = (newMatch ? newMatch[1] : m[2]).trim();
    if (!rawNew) {
      errors.push(
        `Op "${op}" target="${target}" has empty content between <edit>...</edit>`,
      );
      continue;
    }
    ops.push({ type: op, target, newHtml: rawNew });
  }

  return { ops, errors };
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function isValidOpType(s: string): s is OpType {
  return (
    s === "replace" ||
    s === "insert_before" ||
    s === "insert_after" ||
    s === "delete"
  );
}

export interface OpApplyError {
  opIndex: number;
  op: OpType;
  target: string;
  reason: string;
}

export interface OpApplyResult {
  /** Final HTML after all ops applied + IDs stripped. Null on any failure. */
  html: string | null;
  errors: OpApplyError[];
  appliedCount: number;
}

/** Apply ops in emission order against a tagged HTML document. Validate all
 *  target IDs against the ORIGINAL document first (no partial-apply) — if
 *  any target is missing, bail. Successful run returns the spliced doc with
 *  IDs stripped. */
export function applyOps(taggedHtml: string, ops: Op[]): OpApplyResult {
  if (ops.length === 0) {
    return { html: null, errors: [], appliedCount: 0 };
  }

  const $ = cheerio.load(taggedHtml, { xmlMode: false });
  const errors: OpApplyError[] = [];

  // Phase 1 — validate every target exists in the ORIGINAL doc. This avoids
  // partial-apply where op 1 succeeds, op 2 fails, and the user is left
  // with a half-mutated doc. We also reject targets that exist multiple
  // times (shouldn't happen given our tagging, but defense in depth).
  ops.forEach((op, i) => {
    const selector = `[${OP_ID_ATTR}="${escapeAttr(op.target)}"]`;
    const $matched = $(selector);
    if ($matched.length === 0) {
      errors.push({
        opIndex: i,
        op: op.type,
        target: op.target,
        reason: `No element with ${OP_ID_ATTR}="${op.target}" — model addressed an ID that doesn't exist in the document.`,
      });
    } else if ($matched.length > 1) {
      errors.push({
        opIndex: i,
        op: op.type,
        target: op.target,
        reason: `Multiple elements with ${OP_ID_ATTR}="${op.target}" — tagging invariant violated.`,
      });
    }
    // Sanity-check the new HTML parses without exploding. Cheerio is
    // forgiving so this rarely catches real issues, but a totally empty
    // op.newHtml on a non-delete is worth flagging here.
    if (op.type !== "delete") {
      if (!op.newHtml || op.newHtml.trim().length === 0) {
        errors.push({
          opIndex: i,
          op: op.type,
          target: op.target,
          reason: `Op needs non-empty <new> content`,
        });
      }
    }
  });

  if (errors.length > 0) {
    return { html: null, errors, appliedCount: 0 };
  }

  // Phase 2 — apply best-effort. Cascade failures (where an earlier op
  // deletes a section, invalidating child IDs of later ops) are recorded
  // as warnings but do NOT abort the apply. This lets autofill flows
  // (where Kimi may emit hundreds of ops including section-delete +
  // child-replace combos) get the maximum partial result instead of
  // bailing on the whole thing. Caller inspects `errors` to decide if
  // the failure ratio is acceptable.
  let appliedCount = 0;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const selector = `[${OP_ID_ATTR}="${escapeAttr(op.target)}"]`;
    const $el = $(selector);
    if ($el.length === 0) {
      errors.push({
        opIndex: i,
        op: op.type,
        target: op.target,
        reason: `Target became unreachable after earlier ops (likely an ancestor was deleted).`,
      });
      continue;
    }
    try {
      switch (op.type) {
        case "replace":
          $el.replaceWith(op.newHtml ?? "");
          break;
        case "insert_before":
          $el.before(op.newHtml ?? "");
          break;
        case "insert_after":
          $el.after(op.newHtml ?? "");
          break;
        case "delete":
          $el.remove();
          break;
      }
      appliedCount += 1;
    } catch (err) {
      errors.push({
        opIndex: i,
        op: op.type,
        target: op.target,
        reason: err instanceof Error ? err.message : "cheerio threw",
      });
    }
  }

  // Strip the data-op-id attrs and serialize. Use cheerio's serializer so
  // we get the clean output (it'll preserve doctype, html/head/body
  // structure, and proper attribute quoting).
  $(`[${OP_ID_ATTR}]`).each((_, el) => {
    if (el.type === "tag") {
      $(el).removeAttr(OP_ID_ATTR);
    }
  });

  const html = $.html();
  return { html, errors, appliedCount };
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '\\"');
}
