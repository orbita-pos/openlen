import postcss, { type AtRule } from "postcss";

// ─────────────────────────────────────────────────────────────────────────────
// Section scoper — turns a full generated section document into a host-safe,
// insertable fragment.
//
// The generated files are complete <!doctype html> docs whose <head> carries a
// global <style> (with :root{--accent…} + component classes like .btn/.card)
// and whose <body> holds a single <section>/<header>/<footer>. Dropped raw into
// a user's page that already has its OWN :root and .btn/.card, the section
// would (a) clobber the host's theme via the second :root and (b) collide on
// the shared class names. So we ISOLATE it:
//
//   1. tag the root element with data-sec="<slug>"
//   2. rewrite every selector in the section's CSS to live under that wrapper
//      (:root/html/body → the wrapper; .x → [data-sec] .x)
//   3. namespace @keyframes (otherwise two sections' "pulse" collide globally)
//
// Tailwind utility classes (mt-7, max-w-3xl…) are NOT namespaced — they come
// from the host's Tailwind CDN and are identical everywhere, so they don't
// collide. Only the section's own <style> rules get scoped.
//
// Done at ingest, so the STORED fragment is already host-safe. <script> blocks
// are preserved verbatim (some variants render content via JS).
// ─────────────────────────────────────────────────────────────────────────────

export interface ScopedSection {
  /** font <link>(s) + scoped <style> + body inner with data-sec on the root. */
  html: string;
  rootTag: string;
  designTokens: Record<string, string>;
  fonts: string[];
  needsJs: boolean;
}

const ROOT_TAGS = ["section", "header", "footer", "nav", "main", "article", "aside"];

export function scopeSectionDocument(fullHtml: string, slug: string): ScopedSection {
  const scope = `[data-sec="${slug}"]`;

  // 1. collect all <style> css
  const styleCss = matchAll(fullHtml, /<style\b[^>]*>([\s\S]*?)<\/style>/gi)
    .map((m) => m[1])
    .join("\n");

  // 2. google-fonts <link>s
  const fontTags: string[] = [];
  const fonts: string[] = [];
  for (const m of matchAll(fullHtml, /<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href =
      /href\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ??
      /href\s*=\s*'([^']+)'/i.exec(tag)?.[1] ??
      null;
    if (href && /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) {
      fontTags.push(tag);
      if (/fonts\.googleapis\.com\/css/i.test(href)) fonts.push(href);
    }
  }

  // 3. body inner (fall back to the whole input if there's no <body>)
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(fullHtml);
  let bodyInner = bodyMatch ? bodyMatch[1] : fullHtml;

  // 4. find the root element + inject data-sec on its opening tag
  const rootRe = new RegExp(`<(${ROOT_TAGS.join("|")})\\b`, "i");
  const rootM = rootRe.exec(bodyInner);
  const rootTag = rootM ? rootM[1].toLowerCase() : "div";
  if (rootM) {
    const at = rootM.index + rootM[0].length; // just after "<section"
    bodyInner = `${bodyInner.slice(0, at)} data-sec="${slug}"${bodyInner.slice(at)}`;
  }

  // 5. content-bearing inline JS? (ignore ld+json data blocks)
  const needsJs = matchAll(bodyInner, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi).some((m) => {
    if (/type\s*=\s*["']application\/(ld\+json|json)["']/i.test(m[1] || "")) return false;
    return m[2].trim().length > 0;
  });

  // 6. design tokens from the original :root
  const designTokens = extractRootVars(styleCss);

  // 7. scope the css
  // Adopt the host page's palette (deterministic, at ingest): remap the
  // section's own surface/text tokens to reference the host's tokens, drop
  // standalone-document shell artifacts (100vh, full-bleed gutter bg, page-nav
  // sticky), and add a utility shim so the section reads as native instead of
  // carrying its authored light/dark look into a contrasting page.
  const scopedCss = applyHostAdoption(scopeCss(styleCss, scope, slug), slug);

  // 8. assemble the host-safe fragment
  const parts: string[] = [];
  for (const t of dedupe(fontTags)) parts.push(t);
  if (scopedCss.trim()) parts.push(`<style>\n${scopedCss}\n</style>`);
  parts.push(bodyInner.trim());

  return { html: parts.join("\n"), rootTag, designTokens, fonts: dedupe(fonts), needsJs };
}

// ── CSS scoping ──────────────────────────────────────────────────────────────

function scopeCss(css: string, scope: string, slug: string): string {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css; // fail open — a section with unparseable CSS still inserts
  }

  const suffix = slug.replace(/[^a-z0-9-]/gi, "");

  // namespace @keyframes, then rewrite the declarations that reference them
  const renamed: Record<string, string> = {};
  root.walkAtRules((at) => {
    if (/^(-\w+-)?keyframes$/i.test(at.name)) {
      const oldName = at.params.trim();
      if (!oldName || renamed[oldName]) return;
      renamed[oldName] = `${oldName}__${suffix}`;
      at.params = renamed[oldName];
    }
  });
  if (Object.keys(renamed).length > 0) {
    root.walkDecls(/^(-\w+-)?animation(-name)?$/i, (decl) => {
      let v = decl.value;
      for (const [oldName, newName] of Object.entries(renamed)) {
        v = v.replace(
          new RegExp(`(^|[\\s,])${escapeReg(oldName)}($|[\\s,])`, "g"),
          `$1${newName}$2`,
        );
      }
      decl.value = v;
    });
  }

  // scope every rule selector, but NOT the percentage stops inside @keyframes
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) {
      return;
    }
    rule.selectors = rule.selectors.map((s) => scopeSelector(s, scope));
  });

  return root.toString();
}

function scopeSelector(selector: string, scope: string): string {
  const s = selector.trim();
  if (!s) return s;
  // already scoped (idempotent)
  if (s.startsWith(scope)) return s;
  // root-ish selectors land on the wrapper element itself
  if (/^(:root|html|body)$/i.test(s)) return scope;
  // "body .x" / "html > .x" → wrapper takes the place of body/html
  const lead = /^(?::root|html|body)(\s*[>+~]?\s*)(.*)$/i.exec(s);
  if (lead) return `${scope}${lead[1] || " "}${lead[2]}`.trimEnd();
  // bare universal reset → wrapper + its descendants
  if (s === "*") return `${scope}, ${scope} *`;
  // General case. The original selector's first compound may target the
  // WRAPPER element itself — generated sections routinely put a wrapper class
  // (.sec / .lc07 / .hero…) on the root <section> and key every rule off it.
  // A plain descendant scope (`[data-sec] .sec`) does NOT match the root (an
  // element is not its own descendant), so the wrapper's background + text
  // color silently drop. Emit BOTH: the root-or-self match (scope merged into
  // the first compound) and the descendant match. Faithful to the source
  // cascade — if the root genuinely lacks the class, the self-variant matches
  // nothing and is harmless.
  const self = scopeFirstCompound(s, scope);
  const descendant = `${scope} ${s}`;
  return self && self !== descendant ? `${self}, ${descendant}` : descendant;
}

// Merge the scope attribute into the FIRST compound of a complex selector so
// it matches when that compound is the wrapper element itself.
//   ".lc07 .logo svg" → '[data-sec="x"].lc07 .logo svg'
//   "section.foo"     → 'section[data-sec="x"].foo'
function scopeFirstCompound(selector: string, scope: string): string | null {
  const m = /^([^\s>+~]+)([\s\S]*)$/.exec(selector.trim());
  if (!m) return null;
  return `${mergeCompound(m[1], scope)}${m[2]}`;
}

function mergeCompound(compound: string, scope: string): string {
  // scope is an attribute selector (e.g. '[data-sec="x"]'); place it after an
  // optional leading type selector so the compound stays valid CSS.
  const t = /^([a-zA-Z][\w-]*|\*)?([\s\S]*)$/.exec(compound);
  const type = t?.[1] ?? "";
  const rest = t?.[2] ?? "";
  if (type === "*") return `${scope}${rest}`;
  return `${type}${scope}${rest}`;
}

// Repair helper for fragments scoped by the pre-fix scoper: given ALREADY-scoped
// CSS, add the missing root-or-self variant to every descendant-scoped rule.
// Idempotent — skips variants already present and leaves child/`:root`/`*`
// forms (which already match the root correctly) untouched.
export function backfillRootSelfVariants(css: string, slug: string): string {
  const scope = `[data-sec="${slug}"]`;
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) {
      return;
    }
    const prefix = `${scope} `;
    const seen = new Set(rule.selectors.map((x) => x.trim()));
    const out: string[] = [];
    for (const sel of rule.selectors) {
      const s = sel.trim();
      out.push(s);
      if (!s.startsWith(prefix)) continue; // only descendant-scoped rules
      const original = s.slice(prefix.length); // recover the source selector
      const self = scopeFirstCompound(original, scope);
      if (self && !seen.has(self)) {
        out.push(self);
        seen.add(self);
      }
    }
    rule.selectors = out;
  });
  return root.toString();
}

// ── section host-safety pass ──────────────────────────────────────────────────
//
// Sections were authored as standalone documents: they carry a full-bleed
// page-gutter background + 100vh "preview shell" on the root, a page-level
// sticky header, and lean on bespoke utility classes (bg-surface/text-ink/…)
// that the host never registers. Dropped into a real page, the shell adds a
// tall white block at the bottom + a sticky bar that fights the host nav, and
// the unregistered utilities render unstyled (invisible text / wrong fills).
//
// applyHostAdoption makes the section host-SAFE + readable (NOT a forced palette
// match — see below):
//   1. neutralize standalone-shell artifacts on the ROOT rule only: viewport
//      min-height, the light full-bleed gutter background, grid-centering, and a
//      page-level sticky/fixed header (z-index ≥ 20 — leaves in-section sticky
//      like a pricing table's thead at z-index:3 untouched).
//   2. append a scoped utility shim defining the bespoke classes in terms of the
//      section's OWN tokens, so the section renders as authored (readable) on any
//      host instead of unstyled.
//   3. repair the earlier (reverted) palette remap: unwrap any
//      `--surface: var(--bg, <orig>)` back to `<orig>`.
//
// We deliberately do NOT remap the section's tokens to the host's palette.
// Sections use --ink/--surface as dark FILLS as often as text/surfaces, so
// aliasing them to the host (e.g. --ink → host --fg, which is light on a dark
// page) INVERTED them — a dark announcement bar (`background:var(--ink)`)
// rendered white-on-white. Intentional light↔dark matching is the AI "Match to
// page" job (it understands per-element roles); deterministic token swaps can't.
//
// Idempotent: re-running is a no-op (unwrap/removals/shim are all guarded), so
// it's safe at ingest AND as a backfill that ALSO repairs prior-remapped fragments.

const ADOPT_MARKER = "ol-host-adopt";

// Section theme tokens a prior version forward-remapped to host tokens; we now
// only UNWRAP those (var(--host, <orig>) → <orig>) to undo that remap.
const HOST_VAR_ALIASES: Record<string, string> = {
  "--surface": "--bg",
  "--surface-2": "--bg",
  "--surface-3": "--bg",
  "--ink": "--fg",
  "--ink-2": "--fg-dim",
  "--ink-3": "--fg-faint",
  "--muted": "--fg-dim",
  "--line": "--border",
};

// bespoke utility class → [css property, section token it reads].
const SHIM_UTILS: [string, string, string][] = [
  ["bg-surface", "background", "--surface"],
  ["text-ink", "color", "--ink"],
  ["text-ink2", "color", "--ink-2"],
  ["text-muted", "color", "--muted"],
  ["border-line", "border-color", "--line"],
  ["rounded-theme", "border-radius", "--radius"],
  ["font-display", "font-family", "--font-display"],
  ["font-body", "font-family", "--font-body"],
];

export function applyHostAdoption(css: string, slug: string): string {
  const scope = `[data-sec="${slug}"]`;
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css; // fail open — unparseable CSS still inserts (just un-adopted)
  }

  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) {
      return;
    }
    if (!ruleTargetsRoot(rule, scope)) {
      neutralizeStickyNav(rule); // descendant rule — only de-stick a page-level nav
      return;
    }

    // ROOT rule — repair any prior forward-remap (unwrap var(--host, <orig>) →
    // <orig>), then strip shell artifacts. We do NOT alias tokens to the host.
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith("--")) return;
      if (!(decl.prop in HOST_VAR_ALIASES)) return;
      const m = /^var\(\s*--[\w-]+\s*,\s*([\s\S]+)\)$/.exec(decl.value.trim());
      if (m) decl.value = m[1].trim();
    });

    let hadViewportHeight = false;
    let marginReset = false;
    let gutterBg = false;
    rule.walkDecls((d) => {
      const p = d.prop.toLowerCase();
      if ((p === "min-height" || p === "height") && hasViewportUnit(d.value)) hadViewportHeight = true;
      if (p === "margin" && /^0(px)?$/.test(d.value.trim())) marginReset = true;
      if (/^background(-color|-image)?$/.test(p) && isGutterBg(d.value)) gutterBg = true;
    });
    const removeBg = hadViewportHeight || (marginReset && gutterBg);

    rule.walkDecls((d) => {
      const p = d.prop.toLowerCase();
      if ((p === "min-height" || p === "height") && hasViewportUnit(d.value)) {
        d.remove();
        return;
      }
      if (removeBg && /^background(-color|-image|-attachment|-position|-repeat|-size)?$/.test(p)) {
        d.remove();
        return;
      }
      if (hadViewportHeight && p === "display" && /\b(grid|flex)\b/i.test(d.value)) {
        d.remove();
        return;
      }
      if (
        hadViewportHeight &&
        /^(place-items|place-content|align-items|justify-items|justify-content)$/.test(p)
      ) {
        d.remove();
      }
    });

    neutralizeStickyNav(rule);
  });

  let out = root.toString();
  if (!css.includes(ADOPT_MARKER)) {
    const shim = SHIM_UTILS.map(
      ([cls, prop, varName]) =>
        `${scope}.${cls}, ${scope} .${cls}{${prop}:var(${varName})}`,
    ).join("\n");
    out += `\n/* ${ADOPT_MARKER} */\n${shim}\n`;
  }
  return out;
}

// A page-level sticky/fixed header (z-index ≥ 20) would overlay the host's own
// navbar once inserted. De-stick it. In-section sticky at low z-index (e.g. a
// pricing table's `thead th` at z-index:3) is left intact.
function neutralizeStickyNav(rule: postcss.Rule): void {
  let pos: postcss.Declaration | null = null;
  let z: number | null = null;
  rule.walkDecls((d) => {
    const p = d.prop.toLowerCase();
    if (p === "position") pos = d;
    else if (p === "z-index") {
      const n = parseInt(d.value, 10);
      if (Number.isFinite(n)) z = n;
    }
  });
  if (pos && /^(sticky|fixed)$/i.test((pos as postcss.Declaration).value.trim()) && (z ?? 0) >= 20) {
    (pos as postcss.Declaration).value = "static";
  }
}

// Does this selector target the section ROOT element itself (root-or-self),
// rather than a descendant of it? `[data-sec="x"]`, `section[data-sec="x"]`,
// `[data-sec="x"].nav-root` → true; `[data-sec="x"] .foo` → false.
function isRootSelector(selector: string, scope: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  const idx = s.indexOf(scope);
  if (idx < 0) return false;
  const before = s.slice(0, idx);
  const after = s.slice(idx + scope.length);
  if (before && !/^[a-zA-Z][\w-]*$/.test(before)) return false; // only a leading type selector
  if (/[\s>+~]/.test(after)) return false; // a combinator after the scope ⇒ descendant
  return true;
}

function ruleTargetsRoot(rule: postcss.Rule, scope: string): boolean {
  return rule.selectors.some((s) => isRootSelector(s, scope));
}

function hasViewportUnit(value: string): boolean {
  return /\b\d*\.?\d+(vh|dvh|svh|lvh)\b/i.test(value);
}

// A "gutter" background is the standalone document's body background that the
// scoper moved onto the section root: a solid very-light colour or a light
// gradient with no theme var. Intentional var-driven / coloured backgrounds
// (which we want to keep + which adopt the host via the token remap) return false.
function isGutterBg(value: string): boolean {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(v);
  if (hex) return isLightHex(hex[1]);
  if ((v.includes("linear-gradient") || v.includes("radial-gradient")) && !v.includes("var(")) {
    const hexes = v.match(/#[0-9a-f]{6}/g) ?? [];
    return hexes.length > 0 && hexes.every((h) => isLightHex(h.slice(1)));
  }
  return false;
}

function isLightHex(h: string): boolean {
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Math.min(r, g, b) >= 0xdb; // very light, near-neutral page background
}

// ── helpers ──────────────────────────────────────────────────────────────────

function extractRootVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      if (rule.selectors.some((s) => s.trim() === ":root")) {
        rule.walkDecls((d) => {
          if (d.prop.startsWith("--")) out[d.prop] = d.value;
        });
      }
    });
  } catch {
    /* ignore */
  }
  return out;
}

function matchAll(s: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = r.exec(s)) !== null) {
    out.push(m);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
