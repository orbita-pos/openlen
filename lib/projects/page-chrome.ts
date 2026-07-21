// Chrome extraction for new-page shells — finds the home's REAL navbar and
// footer, wrapper included. A plain "first <header>/<nav>" regex breaks on the
// curated templates: their navbar is often a styled DIV capsule (fixed,
// rounded) with an inner <nav>, and the hero carries a second decorative
// <header> — so the regex promoted the wrong element and shipped new pages
// with a bare, style-less bar. This walks tag depth instead: pick the first
// nav/header landmark that isn't hero content (no <h1>), then climb to the
// outermost ancestor that still looks like chrome, so the capsule's styling
// travels with it. Footers get the same climb plus a © fallback for
// non-semantic <div> footers. Never invents chrome: no landmark → "".

interface Span {
  name: string;
  start: number;
  end: number;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Elements whose content is skipped wholesale: raw-text per the HTML spec
// (script/style/textarea/title may contain "<") plus <pre> — spec-wise it
// parses, but its typical content is code samples whose <nav>/<footer> must
// never be promoted to site chrome.
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "pre"]);

// Attribute grammar is real (name, then optionally = and a quoted/unquoted
// value) — NOT a loose "any quoted run" alternation, which let a bare
// apostrophe in an unquoted value (alt=chef's-special) swallow every tag up
// to the next apostrophe in the document.
const TAG_RE =
  /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*\s*\/?>/g;

// Per-tag closing patterns, case-insensitive REGEX over the original string —
// never a lowercased copy: "İ".toLowerCase() is 2 code units, so a lowered
// copy drifts every index after it (and re-lowering per raw-text tag was
// O(tags × doc) anyway). The [\s>] tail rejects "</styleX".
const RAW_CLOSE_RES = new Map<string, RegExp>();
function rawCloseRe(name: string): RegExp {
  let re = RAW_CLOSE_RES.get(name);
  if (!re) {
    re = new RegExp(`</${name}[\\s>]`, "gi");
    RAW_CLOSE_RES.set(name, re);
  }
  return re;
}

/** Every closed element's [start, end) span, document order lost — callers
 *  sort. Lenient on malformed nesting (unmatched closes ignored, crossed
 *  elements closed together). Null when a raw-text element never closes. */
function parseSpans(html: string): Span[] | null {
  const spans: Span[] = [];
  const stack: Array<{ name: string; start: number }> = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const name = m[1]?.toLowerCase();
    if (!name) continue;
    if (m[0][1] === "/") {
      let open = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { open = i; break; }
      }
      if (open === -1) continue;
      while (stack.length > open) {
        const el = stack.pop()!;
        // Only the element this close tag actually matches gets a span. The
        // ones above it (crossed, implicitly closed) would slice to malformed
        // fragments — "<nav>…</div>" — so they must never become extraction
        // targets or wrappers.
        if (stack.length === open) {
          spans.push({ name: el.name, start: el.start, end: TAG_RE.lastIndex });
        }
      }
    } else {
      if (VOID_TAGS.has(name) || m[0].endsWith("/>")) continue;
      if (RAW_TEXT_TAGS.has(name)) {
        const closeRe = rawCloseRe(name);
        closeRe.lastIndex = TAG_RE.lastIndex;
        const closeM = closeRe.exec(html);
        if (!closeM) return null;
        const closeEnd = html.indexOf(">", closeM.index);
        if (closeEnd === -1) return null;
        TAG_RE.lastIndex = closeEnd + 1;
        continue;
      }
      stack.push({ name, start: m.index });
    }
  }
  return spans;
}

/** Could this slice be site chrome (navbar/footer) rather than page content?
 *  Content markers: a heading (h1 hero, h2 CTA band) or a <section>. */
function looksLikeChrome(slice: string, maxLen: number): boolean {
  return (
    slice.length <= maxLen &&
    !/<h[12][\s>]/i.test(slice) &&
    !/<section[\s>]/i.test(slice)
  );
}

/** Outermost ancestor of `target` that still passes the chrome test; the
 *  target itself when none does. `extraGuard` lets footers demand ancestors
 *  that close near the end of the body. */
function expandToWrapper(
  html: string,
  spans: Span[],
  target: Span,
  maxLen: number,
  extraGuard?: (a: Span) => boolean,
): Span {
  const ancestors = spans
    .filter((a) => a.start < target.start && a.end > target.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  for (const a of ancestors) {
    if (!looksLikeChrome(html.slice(a.start, a.end), maxLen)) continue;
    if (extraGuard && !extraGuard(a)) continue;
    return a;
  }
  return target;
}

const COPYRIGHT_RE = /©|&copy;|all rights reserved|todos los derechos/gi;

export function extractChrome(bodyInner: string): { header: string; footer: string } {
  let spans: Span[] | null;
  try {
    spans = parseSpans(bodyInner);
  } catch {
    spans = null;
  }
  if (!spans) return legacyChrome(bodyInner);

  const maxLen = bodyInner.length * 0.5;
  // Footers must close near the body's end — a mid-page wrapper that happens
  // to contain the last <footer> is content, not chrome.
  const nearEnd = (a: Span) =>
    a.end >= bodyInner.length - Math.max(200, bodyInner.length * 0.15);

  // ── Footer: last <footer>, expanded to its styled wrapper. Without one,
  // the innermost element around the last late-page © notice — but only when
  // that element ITSELF reads as end-of-page chrome (a mid-gallery
  // <figcaption>© Studio> or a whole-page wrapper must not become the footer).
  let footerSpan: Span | null = null;
  const footers = spans.filter((s) => s.name === "footer").sort((a, b) => a.start - b.start);
  if (footers.length) {
    footerSpan = expandToWrapper(bodyInner, spans, footers[footers.length - 1], maxLen, nearEnd);
  } else {
    let markIdx = -1;
    for (const m of bodyInner.matchAll(COPYRIGHT_RE)) markIdx = m.index;
    if (markIdx >= bodyInner.length * 0.4) {
      const holder = spans
        .filter((s) => s.start <= markIdx && s.end > markIdx)
        .sort((a, b) => b.start - a.start || a.end - b.end)[0];
      if (holder) {
        const cand = expandToWrapper(bodyInner, spans, holder, maxLen, nearEnd);
        if (looksLikeChrome(bodyInner.slice(cand.start, cand.end), maxLen) && nearEnd(cand)) {
          footerSpan = cand;
        }
      }
    }
  }

  // ── Navbar: first <header>/<nav> landmark in document order that isn't
  // hero content, expanded to its capsule wrapper.
  let headerSpan: Span | null = null;
  const landmarks = spans
    .filter((s) => s.name === "header" || s.name === "nav")
    .sort((a, b) => a.start - b.start);
  for (const lm of landmarks) {
    if (/<h1[\s>]/i.test(bodyInner.slice(lm.start, lm.end))) continue;
    headerSpan = expandToWrapper(bodyInner, spans, lm, maxLen);
    break;
  }

  // A navbar that lives inside (or around) the footer is the footer's — don't
  // repeat it at the top of the page.
  if (headerSpan && footerSpan && headerSpan.start < footerSpan.end && footerSpan.start < headerSpan.end) {
    headerSpan = null;
  }

  return {
    header: headerSpan ? bodyInner.slice(headerSpan.start, headerSpan.end) : "",
    footer: footerSpan ? bodyInner.slice(footerSpan.start, footerSpan.end) : "",
  };
}

/** The pre-2026-07 regex behavior — only reached when the body doesn't
 *  tokenize (unclosed <script>/<style>). Never worse than the old shell —
 *  plus the same header/footer overlap guard the parsed path applies, so a
 *  footer-nested <header> can't render the brand twice on the new page. */
function legacyChrome(bodyInner: string): { header: string; footer: string } {
  const hm =
    /<header[\s\S]*?<\/header>/i.exec(bodyInner) ??
    /<nav[\s\S]*?<\/nav>/i.exec(bodyInner);
  let header = hm?.[0] ?? "";
  let footer = "";
  let footerStart = -1;
  for (const m of bodyInner.matchAll(/<footer[\s\S]*?<\/footer>/gi)) {
    footer = m[0];
    footerStart = m.index;
  }
  if (hm && footerStart !== -1) {
    const hEnd = hm.index + hm[0].length;
    const fEnd = footerStart + footer.length;
    if (hm.index < fEnd && footerStart < hEnd) header = "";
  }
  return { header, footer };
}
