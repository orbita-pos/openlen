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
  const scopedCss = scopeCss(styleCss, scope, slug);

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
  return `${scope} ${s}`;
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
