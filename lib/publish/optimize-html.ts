// ─────────────────────────────────────────────────────────────────────────────
// Publish-time HTML optimizer.
//
// Curated templates ship with the Tailwind CDN runtime (`cdn.tailwindcss.com`)
// for editor preview convenience. In production that script blocks initial
// paint (~200ms script eval + CSS computation) and torpedoes Lighthouse
// performance. This module:
//
//   1. Walks the HTML for every used utility class.
//   2. Runs Tailwind's PostCSS plugin against that content set to generate
//      the minimal CSS the page actually needs (preflight + utilities).
//   3. Strips the CDN <script> and inlines the generated CSS in <head>.
//
// Idempotent: if no CDN script is found, the HTML passes through unchanged
// — safe to run on already-baked HTML.
// ─────────────────────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const TAILWIND_INPUT = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

export interface OptimizeResult {
  html: string;
  /** True when CDN replacement happened (i.e. CSS was inlined). */
  baked: boolean;
  /** Bytes of generated CSS (0 when unchanged). */
  cssBytes: number;
}

export async function optimizeHtmlForProduction(
  html: string,
): Promise<OptimizeResult> {
  const $ = cheerio.load(html);

  // Match any tailwind CDN URL (cdn.tailwindcss.com, with or without
  // version/path suffix, and the play.tailwindcss.com staging variant).
  const cdnScript = $("script").filter((_, el) => {
    const src = $(el).attr("src") || "";
    return /(?:cdn|play)\.tailwindcss\.com/i.test(src);
  });

  if (cdnScript.length === 0) {
    return { html, baked: false, cssBytes: 0 };
  }

  const css = await generateTailwindCss(html);
  cdnScript.replaceWith(
    `<style data-tw-baked>\n${css}\n</style>`,
  );

  return { html: $.html(), baked: true, cssBytes: css.length };
}

async function generateTailwindCss(html: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: html, extension: "html" }],
      theme: { extend: {} },
      plugins: [],
      corePlugins: { preflight: true },
    }),
  ]).process(TAILWIND_INPUT, { from: undefined });

  return result.css;
}
