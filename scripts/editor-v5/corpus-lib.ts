// Editor V5 hardening — shared corpus harness helpers.
//
// Used by both the diagnostic probe (scripts/editor-v5/diagnose.ts) and the
// committed visual-regression suite so the two render the corpus IDENTICALLY.
//
// The sandbox has selective network egress: the openlen.com/R2 hosts are
// reachable (so the bodies were fetched) but cdn.tailwindcss.com + Google Fonts
// are NOT. Production renders these bodies via the Tailwind Play CDN; offline we
// substitute a corpus-wide PRE-COMPILED Tailwind stylesheet (built once by
// `npx tailwindcss --content tests/visual/corpus/**/*.html`). Font metrics fall
// back to system fonts, but every measurement here compares the overlay against
// the original IN THE SAME RENDER, so fallback fonts cancel out — what we test
// is overlay↔original CONSISTENCY, which is the real product requirement.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

export const CORPUS_DIR = join(process.cwd(), "tests", "visual", "corpus");
export const TAILWIND_CSS_PATH = join(CORPUS_DIR, "tailwind-corpus.css");
export const MANIFEST_PATH = join(CORPUS_DIR, "manifest.json");

export interface CorpusEntry {
  id: string;
  kind: "template" | "section";
  group: string;
  mode: string;
  accent?: string;
  rootTag?: string;
  needsJs?: boolean;
  hasPlaceholders?: boolean;
  storageUrl: string;
  bytes: number;
  file: string;
}

export function readManifest(): { entries: CorpusEntry[] } {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

export function loadTailwindCss(): string {
  if (!existsSync(TAILWIND_CSS_PATH)) {
    throw new Error(
      `Missing ${TAILWIND_CSS_PATH}. Build it:\n  printf '@tailwind base;@tailwind components;@tailwind utilities;' > /tmp/in.css && npx tailwindcss -i /tmp/in.css -o ${TAILWIND_CSS_PATH} --content "tests/visual/corpus/**/*.html"`,
    );
  }
  return readFileSync(TAILWIND_CSS_PATH, "utf8");
}

export function readBody(entry: CorpusEntry): string {
  return readFileSync(join(CORPUS_DIR, entry.file), "utf8");
}

/**
 * Turn a raw corpus body into a fully self-contained, runtime-instrumented
 * document ready for setContent:
 *   - section fragments (no <html>) are wrapped in a minimal host doc
 *   - the Tailwind Play-CDN <script> is swapped for the offline compiled <style>
 *     IN PLACE (preserving cascade order so the body's own inline <style> still
 *     wins), or injected into <head> when absent
 *   - the real inline-edit runtime is injected before </body>
 */
export function prepareDoc(rawHtml: string, tailwindCss: string): string {
  let html = rawHtml;
  const isFragment = !/<html[\s>]/i.test(html);
  const twTag = `<style data-openlen-tw>${tailwindCss}</style>`;

  if (isFragment) {
    html =
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `${twTag}</head><body>${html}</body></html>`;
  } else if (/<script[^>]*cdn\.tailwindcss\.com[^>]*><\/script>/i.test(html)) {
    html = html.replace(
      /<script[^>]*cdn\.tailwindcss\.com[^>]*><\/script>/i,
      twTag,
    );
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${twTag}</head>`);
  } else {
    html = twTag + html;
  }
  return injectInlineEdit(html);
}
