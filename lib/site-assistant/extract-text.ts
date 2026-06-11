import type { ProjectData } from "@/lib/projects/types";

// HTML → clean reading text for the assistant's context window. Regex-based on
// purpose: runs on every chat message against trusted, self-produced HTML
// (our publish pipeline), so a DOM parse buys nothing but latency. Output is
// what a visitor could read on the page — scripts, styles, SVG paths and
// attributes never reach the prompt.

const STRIP_BLOCKS_RE =
  /<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
// Tags whose boundary implies a line break when reading.
const BLOCK_TAG_RE =
  /<\/?(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|tr|td|th|table|br|hr|blockquote|figure|figcaption|form|fieldset|details|summary)\b[^>]*>/gi;
const ANY_TAG_RE = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&middot;": "·",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|middot|mdash|ndash|hellip);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) && n > 8 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
    });
}

/** One HTML document → readable text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(COMMENT_RE, " ")
      .replace(STRIP_BLOCKS_RE, " ")
      .replace(BLOCK_TAG_RE, "\n")
      .replace(ANY_TAG_RE, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** `<html lang="…">` of the home document, normalized ("es-MX" → "es-MX"). */
export function detectPageLang(html: string): string | null {
  const m = /<html\b[^>]*\blang=["']?([a-zA-Z-]{2,12})/i.exec(html);
  return m ? m[1] : null;
}

/** Total prompt-side budget for page text. ~20K chars ≈ 5K tokens — well
 *  inside Flash-Lite limits while keeping per-message cost ≤ ~$0.001. */
export const PAGE_TEXT_BUDGET = 20_000;

/** Whole site (home + extra pages) → one labeled text corpus, budget-capped.
 *  Pages are cut proportionally so a huge home page can't starve the menu
 *  page the visitor is actually asking about. */
export function siteToText(data: ProjectData): string {
  const sections: { label: string; text: string }[] = [];
  const home = htmlToText(data.html);
  if (home) sections.push({ label: "Página principal", text: home });

  for (const [slug, page] of Object.entries(data.pages ?? {})) {
    const text = htmlToText(page.html);
    if (!text) continue;
    sections.push({ label: page.title?.trim() || `/${slug}`, text });
  }
  if (sections.length === 0) return "";

  const perSection = Math.max(
    2_000,
    Math.floor(PAGE_TEXT_BUDGET / sections.length),
  );
  let remaining = PAGE_TEXT_BUDGET;
  const out: string[] = [];
  for (const s of sections) {
    if (remaining <= 0) break;
    const slice = s.text.slice(0, Math.min(perSection, remaining));
    remaining -= slice.length;
    out.push(`## ${s.label}\n${slice}`);
  }
  return out.join("\n\n");
}
