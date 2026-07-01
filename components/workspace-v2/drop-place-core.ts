// Drop engine — pure core logic for the in-iframe drag/paste placement script.
//
// Same contract as inline-edit-core.ts: every function here is BOTH
//   (a) imported + unit-tested by Vitest (jsdom) — see drop-place-core.test.ts
//   (b) serialized via Function.prototype.toString() into the iframe runtime
//       (see use-drop-place.ts)
// so each stringified function must be SELF-CONTAINED: only its own params,
// nested locals, and browser globals; no imports, no calls to sibling exports
// (pass them as params instead); plain ES5 style.
//
// The image classifier + path builder are deliberate copies of the closures in
// use-image-replace.ts (getReplaceableKind / buildPath) and the section finder
// mirrors use-section-insert.ts candidates()/findContentRoot() — those live
// inside injected IIFEs and cannot be imported.

/** Edge band (px) at a section's top/bottom that reads as "insert here". */
export const DROP_EDGE_PX = 24;

/** MIME type the Images panel sets on thumbnail drags. */
export const DROP_ASSET_MIME = "application/x-openlen-image";

/** MIME type the drop script sets when an EXISTING page image is dragged —
 *  the swap gesture (drop it on another image to exchange the two). */
export const DROP_SWAP_MIME = "application/x-openlen-swap";

/** A hosted image dragged from the Images panel (vs an OS File). */
export interface DropAsset {
  url: string;
  alt?: string;
  credit?: { author: string; authorUrl: string; photoUrl: string };
  /** Unsplash compliance ping target — fired by the parent on COMMIT. */
  downloadLocation?: string;
}

/** What a dataTransfer carries: an internal image-swap drag, a panel asset
 *  drag, an OS file drag, or nothing we handle (plain text/selection drags).
 *  Priority swap > asset > files. The MIME literals are inlined
 *  (self-containment rule) — keep in sync with the exported consts. */
export function dropPayloadKind(
  types: ArrayLike<string> | null | undefined,
): "files" | "asset" | "swap" | null {
  if (!types) return null;
  var hasFiles = false;
  var hasAsset = false;
  for (var i = 0; i < types.length; i++) {
    if (types[i] === "application/x-openlen-swap") return "swap";
    if (types[i] === "application/x-openlen-image") hasAsset = true;
    if (types[i] === "Files") hasFiles = true;
  }
  if (hasAsset) return "asset";
  return hasFiles ? "files" : null;
}

/** Parse + shape-check the panel's drag payload. Hostile-input safe: caps
 *  lengths, requires an http(s) or root-relative url, validates the credit
 *  shape. Null on anything off. */
export function parseDropAsset(
  text: string | null | undefined,
): DropAsset | null {
  if (!text || text.length > 4000) return null;
  var data: Record<string, unknown>;
  try {
    var parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    data = parsed as Record<string, unknown>;
  } catch (_e) {
    return null;
  }
  var url = typeof data.url === "string" ? data.url : "";
  if (url.length === 0 || url.length > 2000) return null;
  if (!/^(https?:\/\/|\/)/.test(url)) return null;
  var out: DropAsset = { url: url };
  if (typeof data.alt === "string") out.alt = data.alt.slice(0, 300);
  var c = data.credit as Record<string, unknown> | null | undefined;
  if (
    c &&
    typeof c === "object" &&
    typeof c.author === "string" &&
    typeof c.authorUrl === "string" &&
    typeof c.photoUrl === "string"
  ) {
    out.credit = {
      author: c.author.slice(0, 200),
      authorUrl: c.authorUrl.slice(0, 600),
      photoUrl: c.photoUrl.slice(0, 600),
    };
  }
  if (typeof data.downloadLocation === "string") {
    out.downloadLocation = data.downloadLocation.slice(0, 600);
  }
  return out;
}

/**
 * True when `el` is a droppable IMAGE slot — same detection the Replace hover
 * flow uses (use-image-replace.ts getReplaceableKind), image branch only:
 * <img>, svg larger than 32px (performSwap converts svg→img), or an aspect-*
 * div painted by a background-image. Skips the editor's own injected chrome.
 */
export function isImageDropTarget(el: Element | null): boolean {
  if (!el || !(el as HTMLElement).tagName || !el.getBoundingClientRect) return false;
  if (
    el.closest &&
    (el.closest("[data-openlen-drop]") ||
      el.closest("[data-openlen-replace]") ||
      el.closest("[data-openlen-reorder]"))
  ) {
    return false;
  }
  var tag = (el as HTMLElement).tagName;
  var rect = el.getBoundingClientRect();
  var size = Math.max(rect.width, rect.height);
  if (size < 8) return false;
  if (tag === "IMG") return true;
  if (tag === "svg") return size > 32;
  if (tag === "DIV" && size >= 60) {
    var cls =
      (el as HTMLElement).className && typeof (el as HTMLElement).className === "string"
        ? ((el as HTMLElement).className as string)
        : "";
    if (!/\baspect-/.test(cls)) return false;
    try {
      var cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    } catch (_e) {
      /* detached node — not a target */
    }
  }
  return false;
}

/** Climb from `el` to the nearest image drop target (classifier injected as a
 *  param per the self-containment rule). */
export function findImageDropTarget(
  el: Element | null,
  isTarget: (el: Element) => boolean,
): Element | null {
  while (el && el !== document.body && el !== document.documentElement) {
    if (isTarget(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Top-level page sections that can take a background drop / frame an insert.
 * Mirrors use-section-insert.ts: candidates of the content root (drilling into
 * a single full-page wrapper), excluding inert tags + editor chrome, then
 * filters out thin (<60px) and fixed/absolute elements (floating buttons,
 * cookie banners) that aren't really sections.
 */
export function dropSectionCandidates(body: HTMLElement | null): Element[] {
  var INERT: Record<string, number> = {
    SCRIPT: 1,
    STYLE: 1,
    LINK: 1,
    META: 1,
    NOSCRIPT: 1,
    TEMPLATE: 1,
    TITLE: 1,
  };
  function isChrome(el: Element): boolean {
    return !!(
      el.hasAttribute &&
      (el.hasAttribute("data-openlen-edit-overlay") ||
        el.hasAttribute("data-openlen-edit-ghost") ||
        el.hasAttribute("data-openlen-replace") ||
        el.hasAttribute("data-openlen-reorder") ||
        el.hasAttribute("data-openlen-drop"))
    );
  }
  function kids(parent: Element): Element[] {
    var out: Element[] = [];
    if (!parent || !parent.children) return out;
    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (!el.tagName || INERT[el.tagName]) continue;
      if (isChrome(el)) continue;
      out.push(el);
    }
    return out;
  }
  if (!body) return [];
  var root: Element = body;
  var top = kids(body);
  if (top.length === 1) {
    var deeper = kids(top[0]);
    if (deeper.length >= 2) root = top[0];
  }
  var cand = kids(root);
  var out: Element[] = [];
  for (var j = 0; j < cand.length; j++) {
    var el2 = cand[j];
    var rect = el2.getBoundingClientRect ? el2.getBoundingClientRect() : null;
    if (!rect || rect.height < 60) continue;
    try {
      var pos = getComputedStyle(el2).position;
      if (pos === "fixed" || pos === "absolute") continue;
    } catch (_e) {
      continue;
    }
    out.push(el2);
  }
  return out;
}

/** `:nth-of-type` breadcrumb from <body> down to `el` — same addressing the
 *  Replace + Inspect scripts use (copy of use-image-replace.ts buildPath). */
export function buildPathFromBody(el: Element | null): string {
  var segs: string[] = [];
  var cur: Element | null = el;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML" && cur.parentElement) {
    var tag = cur.tagName.toLowerCase();
    var nth = 1;
    var sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) nth += 1;
      sib = sib.previousElementSibling;
    }
    segs.unshift(tag + ":nth-of-type(" + nth + ")");
    cur = cur.parentElement;
  }
  return segs.join(" > ");
}

/**
 * Pure geometry: which section zone does pointer-y land in?
 *   'before'/'after' — within `edgePx` of a boundary (or above/below all
 *                      sections, or in a gap) → insertion point.
 *   'body'           — inside a section, away from its edges → background.
 * Rects are viewport-relative ({top,bottom}), same space as clientY.
 */
export function resolveDropZone(
  rects: Array<{ top: number; bottom: number }>,
  y: number,
  edgePx: number,
): { index: number; zone: "before" | "after" | "body" } | null {
  if (!rects || !rects.length) return null;
  var last = rects.length - 1;
  if (y < rects[0].top + edgePx) return { index: 0, zone: "before" };
  if (y > rects[last].bottom - edgePx) return { index: last, zone: "after" };
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (y >= r.top && y <= r.bottom) {
      if (y - r.top <= edgePx) return { index: i, zone: "before" };
      if (r.bottom - y <= edgePx) return { index: i, zone: "after" };
      return { index: i, zone: "body" };
    }
    if (i < last && y > r.bottom && y < rects[i + 1].top) {
      return { index: i, zone: "after" };
    }
  }
  return null;
}

/**
 * The element whose children become the text cell of a media split: descend
 * from the section through single-child wrappers (the max-w-* container
 * pattern) until an element with 2+ content children — or stop one level
 * above a leaf text block. Shared VERBATIM by the drop script (canSplit
 * detection) and the inspect script (applySplit transform), so target and
 * transform can never disagree.
 */
export function splitContainer(section: Element | null): Element | null {
  function kidsOf(el: Element): Element[] {
    var out: Element[] = [];
    for (var i = 0; i < el.children.length; i++) {
      var k = el.children[i];
      var t = k.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "LINK" || t === "TEMPLATE") continue;
      out.push(k);
    }
    return out;
  }
  var cur: Element | null = section;
  var depth = 0;
  while (cur && depth < 6) {
    var kids = kidsOf(cur);
    if (kids.length === 0) return null;
    if (kids.length >= 2) return cur;
    if (kidsOf(kids[0]).length === 0) return cur;
    cur = kids[0];
    depth += 1;
  }
  return cur;
}

/**
 * Whether a section can take an "image beside the text" split. Conservative:
 * tall enough, a findable container that isn't already split or laid out in
 * columns (grid / row-flex), no sizable media already telling the visual
 * story, and a sane number of content blocks. The container finder is
 * injected as a param per the self-containment rule.
 */
export function canSplitSection(
  section: Element | null,
  getContainer: (s: Element | null) => Element | null,
): boolean {
  if (!section || !section.getBoundingClientRect) return false;
  var rect = section.getBoundingClientRect();
  if (rect.height < 140) return false;
  var container = getContainer(section);
  if (!container) return false;
  if (container.classList && container.classList.contains("ol-split")) return false;
  var media = section.querySelectorAll("img, svg, video, iframe");
  for (var i = 0; i < media.length; i++) {
    var r = media[i].getBoundingClientRect();
    if (Math.max(r.width, r.height) >= 80) return false;
  }
  if (container.children.length > 8) return false;
  try {
    var cs = getComputedStyle(container);
    if (cs.display === "grid" || cs.display === "inline-grid") return false;
    if (
      (cs.display === "flex" || cs.display === "inline-flex") &&
      cs.flexDirection.indexOf("row") === 0 &&
      container.children.length > 1
    ) {
      return false;
    }
  } catch (_e) {
    return false;
  }
  return true;
}

/**
 * The movable BLOCKS of a section: visible element children of its content
 * container (same splitContainer the media-split uses), excluding inert tags
 * and editor chrome, tall enough to read as a block. Two or more blocks make
 * the per-block move chip worth showing.
 */
export function blockCandidates(container: Element | null): Element[] {
  var INERT: Record<string, number> = {
    SCRIPT: 1,
    STYLE: 1,
    LINK: 1,
    META: 1,
    NOSCRIPT: 1,
    TEMPLATE: 1,
    BR: 1,
    HR: 1,
  };
  if (!container || !container.children) return [];
  var out: Element[] = [];
  for (var i = 0; i < container.children.length; i++) {
    var el = container.children[i];
    if (!el.tagName || INERT[el.tagName]) continue;
    if (
      el.hasAttribute &&
      (el.hasAttribute("data-openlen-edit-overlay") ||
        el.hasAttribute("data-openlen-edit-ghost") ||
        el.hasAttribute("data-openlen-replace") ||
        el.hasAttribute("data-openlen-reorder") ||
        el.hasAttribute("data-openlen-drop"))
    ) {
      continue;
    }
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || rect.height < 18) continue;
    try {
      var pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "absolute") continue;
    } catch (_e) {
      continue;
    }
    out.push(el);
  }
  return out;
}

/** Resize math: pointer delta → clamped width percentage of the parent's
 *  content box. Pure, pinned by tests. */
export function resizeWidthPct(
  startWidthPx: number,
  deltaX: number,
  parentWidthPx: number,
): number {
  if (parentWidthPx <= 0) return 100;
  var pct = ((startWidthPx + deltaX) / parentWidthPx) * 100;
  if (pct < 10) pct = 10;
  if (pct > 100) pct = 100;
  return Math.round(pct * 10) / 10;
}

/** Which body target a pointer-x maps to: outer thirds = media split (when
 *  splittable), center third = background. */
export function resolveBodySide(
  left: number,
  width: number,
  x: number,
  splittable: boolean,
): "left" | "right" | "bg" {
  if (!splittable || width <= 0) return "bg";
  var ratio = (x - left) / width;
  if (ratio < 1 / 3) return "left";
  if (ratio > 2 / 3) return "right";
  return "bg";
}

// ---------------------------------------------------------------------------
// Parent-side helpers (NOT stringified into the iframe).
// ---------------------------------------------------------------------------

/**
 * Legibility plan for a section-background drop, from the image's average
 * WCAG luminance (0..1, from deriveWorldFromFile). Dark and light images get
 * a matching ink with no scrim; mid/busy images get a 45% black scrim so white
 * ink always lands on a known-dark ground. groundLum is what the iframe's
 * scoped re-ink measures text against — for the scrim case it's the image
 * luminance attenuated by the scrim (lum * 0.25), composed HERE so the iframe
 * never owns a constant that could drift.
 */
export function sectionBgPlan(lum: number): {
  ink: string;
  scrimColor: string;
  groundLum: number;
} {
  if (lum <= 0.32) return { ink: "#ffffff", scrimColor: "", groundLum: lum };
  if (lum >= 0.68) return { ink: "#111827", scrimColor: "", groundLum: lum };
  return { ink: "#ffffff", scrimColor: "rgba(0,0,0,0.45)", groundLum: lum * 0.25 };
}

/** Framework-agnostic full-bleed image section (inline styles only, so it
 *  renders identically on Tailwind and plain-CSS pages). */
export function buildImageSectionHtml(url: string, alt: string): string {
  function esc(s: string): string {
    return ("" + s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  return (
    '<section style="margin:0;padding:0;line-height:0;">' +
    '<img src="' +
    esc(url) +
    '" alt="' +
    esc(alt) +
    '" loading="lazy" style="display:block;width:100%;height:auto;margin:0;" />' +
    "</section>"
  );
}

/** A curated animated background loop from the "By OpenLen Motion" library. */
export interface MotionAsset {
  posterHero: string;
  webm: string;
  mp4: string;
}

/**
 * Framework-agnostic full-bleed animated hero (inline styles only, like
 * buildImageSectionHtml). The poster <img> is in-flow — it sets the section
 * height AND is the LCP element the publish image-bake optimizes + preloads;
 * the muted, looping <video> is layered over it (object-fit:cover). Under
 * prefers-reduced-motion the video is hidden and the poster shows through, so
 * the section is never blank and never auto-animates against the user's wish.
 */
export function buildMotionHeroHtml(a: MotionAsset): string {
  function esc(s: string): string {
    return ("" + s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  var poster = esc(a.posterHero);
  // aspect-ratio is a floor: the in-flow poster <img> drives height normally,
  // but if it ever fails to load the section keeps a 16:9 box instead of
  // collapsing to 0px (the video is absolutely positioned, so it can't set it).
  return (
    '<section class="ol-bgvideo" style="position:relative;margin:0;padding:0;line-height:0;overflow:hidden;aspect-ratio:16/9;">' +
    "<style>@media (prefers-reduced-motion:reduce){.ol-bgvideo video{visibility:hidden}}</style>" +
    '<img src="' +
    poster +
    '" alt="" aria-hidden="true" style="display:block;width:100%;height:auto;margin:0;" />' +
    // No poster= on the video: the in-flow <img> above is the poster the bake
    // optimizes + preloads as LCP — a video poster would be a second, remote,
    // un-baked fetch competing for LCP. The img shows through until the loop
    // paints. aria-hidden: the loop is decorative (no captions audit).
    '<video autoplay loop muted playsinline preload="metadata" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;margin:0;">' +
    '<source src="' +
    esc(a.webm) +
    '" type="video/webm" />' +
    '<source src="' +
    esc(a.mp4) +
    '" type="video/mp4" />' +
    "</video>" +
    "</section>"
  );
}

/** "team-photo_v2.jpg" → "team photo v2" — a usable default alt. */
export function fileNameToAlt(name: string): string {
  var base = ("" + (name || "")).replace(/\.[a-zA-Z0-9]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
