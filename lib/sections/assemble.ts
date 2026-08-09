// Server-side page ASSEMBLER core: stitch N stored section fragments into one
// coherent HTML document.
//
// THE coherence mechanism (the spike's lesson): a section ships with its OWN
// hardcoded token block ([data-sec="slug"]{--accent:#3ecf8e;--font-display:
// 'Manrope';--radius:11px}). Stitched as-is, every section keeps its own look →
// "armado por piezas". So we DON'T try to retrieve a matching set (there's no
// family signal to query). Instead we stamp ONE page theme onto --ol-* and
// `bindSectionTokens` rewrites every section's local token DEFINITIONS to point
// at that one theme. After binding, all sections read the same accent / fonts /
// radius → coherent by construction, whatever variants were picked.
//
// Why this is safe here when applyHostAdoption (scope.ts) deliberately refuses
// to bind: that runs at INGEST where the host mode is unknown, so a dark-fill
// `--ink` could invert. The assembler KNOWS the page theme + picks mode-matched
// sections (select.ts), so binding is sound. Role-ambiguous dark-fill sections
// (rare) are routed to the existing /api/sections/prepare AI recolour instead.

import postcss from "postcss";
import { deriveContractColors, type BaseColors } from "../theme-derive";
import { SECTION_TYPE_META, type SectionMode, type SectionType } from "./types";
import { centerOrphanedMaxWidth } from "./scope";
import { getSectionHtml } from "./store";
import type { CanonicalSectionRole } from "@/lib/generation/structural-taxonomy";

export interface AssembleTheme {
  /** The 5 base color roles; the other contract colors are derived. */
  base: BaseColors;
  mode: SectionMode;
  fontDisplay: string;
  fontBody: string;
  fontMono?: string;
  /** Base corner radius the page rounds to (sections scale off --ol-r-scale). */
  radius?: string;
  rScale?: string;
  spaceScale?: string;
  textScale?: string;
  /** Google-Fonts <link> hrefs/tags for the theme's own fonts, hoisted to head. */
  fontLinks?: string[];
}

export interface SectionFragment {
  slug: string;
  type: SectionType;
  /** The stored, already-scoped fragment (font links + <style> + body). */
  html: string;
  /** Semantic role owned by this fragment in a composed page. */
  requestedRole?: CanonicalSectionRole;
}

export class SectionRoleMarkerError extends Error {
  readonly code = "section_role_coverage_failed" as const;

  constructor() {
    super("section_role_coverage_failed");
    this.name = "SectionRoleMarkerError";
  }
}

// A section's local dialect/contract token → the page --ol-* token it binds to.
// --radius is handled specially (kept as a length, scaled by --ol-r-scale).
const TOKEN_TO_OL: Record<string, string> = {
  "--accent": "--ol-accent",
  "--accent-r": "--ol-accent-r",
  "--accent-rgb": "--ol-accent-r",
  "--accent-ink": "--ol-accent-ink",
  "--bg": "--ol-bg",
  "--background": "--ol-bg",
  "--paper": "--ol-bg",
  "--surface": "--ol-surface",
  "--card": "--ol-surface",
  "--surface-2": "--ol-surface-2",
  "--surface-3": "--ol-surface-2",
  "--bg-2": "--ol-surface-2",
  "--fg": "--ol-fg",
  "--ink": "--ol-fg",
  "--text": "--ol-fg",
  "--foreground": "--ol-fg",
  "--fg-muted": "--ol-fg-muted",
  "--ink-2": "--ol-fg-muted",
  "--ink-soft": "--ol-fg-muted",
  "--muted": "--ol-fg-muted",
  "--text-2": "--ol-fg-muted",
  "--fg-faint": "--ol-fg-faint",
  "--ink-3": "--ol-fg-faint",
  "--text-3": "--ol-fg-faint",
  "--border": "--ol-border",
  "--line": "--ol-border",
  "--hair": "--ol-border",
  "--rule": "--ol-border",
  "--border-strong": "--ol-border-strong",
  "--font-display": "--ol-font-display",
  "--font-body": "--ol-font-body",
  "--font-mono": "--ol-font-mono",
};

const LEN_RE = /^-?\d*\.?\d+(px|rem|em)$/i;

/** Rewrite a section's scoped CSS so its local token DEFINITIONS reference the
 *  page theme's --ol-* tokens. Only declarations (e.g. `--accent: #3ecf8e`) are
 *  touched; uses (`background: var(--accent)`) keep working through the rebound
 *  definition. Custom non-theme tokens (e.g. `--nav-h`) are left alone.
 *  Idempotent + fail-open. */
export function bindSectionTokens(css: string): string {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (!prop.startsWith("--")) return;
    if (prop === "--radius") {
      const v = decl.value.trim();
      if (v.includes("var(--ol-r-scale)")) return; // already bound
      if (LEN_RE.test(v)) decl.value = `calc(${v} * var(--ol-r-scale))`;
      return;
    }
    const ol = TOKEN_TO_OL[prop];
    if (!ol) return;
    if (decl.value.includes(`var(${ol})`)) return; // already bound
    decl.value = `var(${ol})`;
  });
  return root.toString();
}

// ── stitch ─────────────────────────────────────────────────────────────────

/** Pull google-font <link>s out of a fragment (to hoist to <head> once). */
function extractFontLinks(html: string): { links: string[]; rest: string } {
  const links: string[] = [];
  const rest = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (/fonts\.(googleapis|gstatic)\.com/i.test(tag)) {
      links.push(tag.trim());
      return "";
    }
    return tag;
  });
  return { links, rest };
}

/** Bind a fragment's <style> blocks to the page theme AND re-centre flush-left
 *  content — so the assembler self-corrects layout, not depending on a prior
 *  `sections:audit --fix` having run over storage. */
function bindStyles(html: string, slug: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_full, open: string, css: string, close: string) => {
      const bound = bindSectionTokens(css);
      return `${open}${centerOrphanedMaxWidth(bound, slug).css}${close}`;
    },
  );
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => x.trim())));
}

// Order top→bottom by section type; keep at most one navbar (first) + one
// footer (last) — two of either is never wanted (mirrors the iframe insert's
// singleton rule, but against the recipe instead of the DOM).
function orderAndDedupe(frags: SectionFragment[]): SectionFragment[] {
  const firstNavbar = frags.find((f) => f.type === "navbar");
  const footers = frags.filter((f) => f.type === "footer");
  const lastFooter = footers[footers.length - 1];
  const kept = frags.filter((f) => {
    if (f.type === "navbar") return f === firstNavbar;
    if (f.type === "footer") return f === lastFooter;
    return true;
  });
  if (kept.some((fragment) => fragment.requestedRole !== undefined)) return kept;
  return kept
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const d = SECTION_TYPE_META[a.f.type].order - SECTION_TYPE_META[b.f.type].order;
      return d !== 0 ? d : a.i - b.i; // stable within a type
    })
    .map((x) => x.f);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markRequestedRole(fragment: SectionFragment, html: string): string {
  if (!fragment.requestedRole) return html;
  const slug = escapeRegex(fragment.slug);
  const rootPattern = new RegExp(
    `<[a-z][a-z0-9:-]*\\b(?=[^>]*\\bdata-sec\\s*=\\s*["']${slug}["'])[^>]*>`,
    "gi",
  );
  const matches = [...html.matchAll(rootPattern)];
  if (matches.length !== 1) throw new SectionRoleMarkerError();
  const root = matches[0][0];
  if (/\bdata-openlen-role\s*=/i.test(root)) throw new SectionRoleMarkerError();
  const marked = root.replace(/>$/, ` data-openlen-role="${fragment.requestedRole}">`);
  return `${html.slice(0, matches[0].index)}${marked}${html.slice((matches[0].index ?? 0) + root.length)}`;
}

function hexToTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

/** The page theme stamped onto <html> as --ol-* (the single source of truth
 *  every bound section reads from). */
function htmlOpenTag(theme: AssembleTheme): string {
  const c = deriveContractColors(theme.base);
  const triplet = hexToTriplet(theme.base.accent);
  const vars = [
    `--ol-bg:${c.bg}`,
    `--ol-surface:${c.surface}`,
    `--ol-surface-2:${c["surface-2"]}`,
    `--ol-fg:${c.fg}`,
    `--ol-fg-muted:${c["fg-muted"]}`,
    `--ol-fg-faint:${c["fg-faint"]}`,
    `--ol-border:${c.border}`,
    `--ol-border-strong:${c["border-strong"]}`,
    `--ol-accent:${c.accent}`,
    triplet ? `--ol-accent-r:${triplet}` : null,
    `--ol-accent-ink:${c["accent-ink"]}`,
    `--ol-radius:${theme.radius ?? "10px"}`,
    `--ol-r-scale:${theme.rScale ?? "1"}`,
    `--ol-space-scale:${theme.spaceScale ?? "1"}`,
    `--ol-text-scale:${theme.textScale ?? "1"}`,
    `--ol-font-display:${theme.fontDisplay}`,
    `--ol-font-body:${theme.fontBody}`,
    `--ol-font-mono:${theme.fontMono ?? "ui-monospace, SFMono-Regular, monospace"}`,
  ]
    .filter(Boolean)
    .join(";");
  return `<html lang="en" class="${theme.mode}" style="${vars}">`;
}

// Contract :root aliases (--accent → var(--ol-accent) …) so a section that uses
// a contract token WITHOUT redefining it still resolves to the page theme.
const CONTRACT_ALIAS_ROOT =
  ":root{--bg:var(--ol-bg);--surface:var(--ol-surface);--surface-2:var(--ol-surface-2);" +
  "--fg:var(--ol-fg);--fg-muted:var(--ol-fg-muted);--fg-faint:var(--ol-fg-faint);" +
  "--border:var(--ol-border);--border-strong:var(--ol-border-strong);" +
  "--accent:var(--ol-accent);--accent-r:var(--ol-accent-r);--accent-ink:var(--ol-accent-ink);" +
  "--radius:var(--ol-radius);--font-display:var(--ol-font-display);" +
  "--font-body:var(--ol-font-body);--font-mono:var(--ol-font-mono);}";

function buildHead(fontLinks: string[]): string {
  return [
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>OpenLen</title>",
    '<script src="https://cdn.tailwindcss.com"></script>',
    ...fontLinks,
    `<style>${CONTRACT_ALIAS_ROOT}\nhtml,body{margin:0;background:var(--ol-bg);color:var(--ol-fg);font-family:var(--font-body);}</style>`,
    "</head>",
  ].join("\n");
}

/** Stitch already-fetched fragments into one coherent document. Pure — no DB,
 *  no DOM, no AI. The recolour is the deterministic token bind, so this spends
 *  zero model calls. */
export function assembleDocument(fragments: SectionFragment[], theme: AssembleTheme): string {
  const ordered = orderAndDedupe(fragments);
  const fontLinks: string[] = [];
  const bodyParts: string[] = [];
  for (const f of ordered) {
    const { links, rest } = extractFontLinks(f.html);
    fontLinks.push(...links);
    bodyParts.push(markRequestedRole(f, bindStyles(rest, f.slug)).trim());
  }
  const links = dedupe([...fontLinks, ...(theme.fontLinks ?? [])]);
  return [
    "<!doctype html>",
    htmlOpenTag(theme),
    buildHead(links),
    "<body>",
    bodyParts.join("\n"),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Fetch the picked sections' stored fragments and assemble them. The DB/R2
 *  read is the only impure part; the rest is assembleDocument. */
export async function stitchSections(
  picks: { slug: string; type: SectionType }[],
  theme: AssembleTheme,
): Promise<string> {
  const fragments: SectionFragment[] = [];
  for (const p of picks) {
    const html = await getSectionHtml(p.slug);
    if (html === null) continue;
    fragments.push({ slug: p.slug, type: p.type, html });
  }
  return assembleDocument(fragments, theme);
}
