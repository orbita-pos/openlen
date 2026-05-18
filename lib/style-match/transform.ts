// Style Match — apply step. Takes the user's HTML + extracted tokens + the
// Gemini vision role assignment, and injects a <style> block that retones the
// page without changing copy or structure.
//
// MVP approach: inject a single high-specificity stylesheet at end-of-<head>.
// We declare CSS variables for the new palette + override the most common
// Tailwind utility patterns the templates use. Future iterations can swap to
// per-element ID-tagged ops if we need finer control.

import * as cheerio from "cheerio";
import type { ExtractedTokens } from "./extract/types";
import type { VisionAnalysis } from "./vision/schema";

const SYSTEM_FONTS = new Set([
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Roboto",
  "Helvetica",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
  "serif",
  "monospace",
]);

const CUSTOM_FONTS_NOT_ON_GOOGLE = new Set([
  "sohne-var",
  "sohne",
  "anthropic sans",
  "berkeley mono",
  "inter variable",
  "sf pro display",
  "sf pro text",
  "-app",
]);

export interface ApplyResult {
  html: string;
  injectedFont: string | null;
  warnings: string[];
}

export function applyStyleMatch(
  userHtml: string,
  tokens: ExtractedTokens,
  vision: VisionAnalysis,
): ApplyResult {
  const warnings: string[] = [];
  const $ = cheerio.load(userHtml);

  $("style[data-style-match]").remove();
  $("link[data-style-match-font]").remove();
  $("meta[data-style-match]").remove();

  if ($("head").length === 0) {
    if ($("html").length > 0) {
      $("html").prepend("<head></head>");
    } else {
      warnings.push("HTML had no <html> root; injection may not render correctly");
    }
  }

  let injectedFont: string | null = null;
  const fontPrimary = tokens.typography.family.primary;
  if (fontPrimary && !isSystemFont(fontPrimary)) {
    if (isLikelyOnGoogleFonts(fontPrimary)) {
      const googleFontUrl = buildGoogleFontUrl(fontPrimary);
      $("head").append(
        `<link rel="preconnect" href="https://fonts.googleapis.com" data-style-match-font>`,
      );
      $("head").append(
        `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin data-style-match-font>`,
      );
      $("head").append(
        `<link href="${googleFontUrl}" rel="stylesheet" data-style-match-font>`,
      );
      injectedFont = fontPrimary;
    } else {
      warnings.push(
        `Font "${fontPrimary}" not on Google Fonts — declared in CSS but won't load; browser falls back to system.`,
      );
    }
  }

  const stylesheet = buildStylesheet(tokens, vision);
  $("head").append(
    `<meta data-style-match name="style-match-source" content="${escapeAttr(tokens.source.hostname)}">`,
  );
  $("head").append(
    `<style data-style-match>\n${stylesheet}\n</style>`,
  );

  return {
    html: $.html(),
    injectedFont,
    warnings,
  };
}

function isSystemFont(name: string): boolean {
  return SYSTEM_FONTS.has(name);
}

function isLikelyOnGoogleFonts(name: string): boolean {
  if (CUSTOM_FONTS_NOT_ON_GOOGLE.has(name.toLowerCase())) return false;
  return /^[A-Za-z][A-Za-z0-9 \-]+$/.test(name);
}

function buildGoogleFontUrl(name: string): string {
  const encoded = name.trim().replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`;
}

function buildStylesheet(
  tokens: ExtractedTokens,
  vision: VisionAnalysis,
): string {
  const { background, foreground_primary, accent, muted, border } =
    vision.color_roles;
  const fontPrimary = quoteFontIfNeeded(tokens.typography.family.primary);

  const radiusValue =
    vision.radius_personality === "sharp"
      ? "0px"
      : vision.radius_personality === "pill"
        ? "9999px"
        : "8px";

  const shadowValue =
    vision.shadow_intensity === "none"
      ? "none"
      : vision.shadow_intensity === "subtle"
        ? "0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.04)"
        : "0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)";

  const stamp = `${tokens.source.hostname} @ ${tokens.source.extractedAt}`;

  return `/* Style Match — applied from ${stamp} */
:root {
  --sm-bg: ${background};
  --sm-fg: ${foreground_primary};
  --sm-accent: ${accent};
  --sm-muted: ${muted};
  --sm-border: ${border};
  --sm-radius: ${radiusValue};
  --sm-shadow: ${shadowValue};
  --sm-font: ${fontPrimary}, system-ui, -apple-system, sans-serif;
}

html, body {
  background-color: var(--sm-bg) !important;
  color: var(--sm-fg) !important;
  font-family: var(--sm-font) !important;
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--sm-font) !important;
  color: var(--sm-fg) !important;
}
p, span, li, td, th, dd, dt, label {
  color: var(--sm-fg);
  font-family: var(--sm-font);
}
a:not([class*="bg-"]):not([role="button"]) {
  color: var(--sm-accent) !important;
}
button, .btn, [role="button"], [type="submit"], [type="button"]:not([class*="bg-transparent"]) {
  background-color: var(--sm-accent) !important;
  color: #ffffff !important;
  border-radius: var(--sm-radius) !important;
  box-shadow: var(--sm-shadow) !important;
  font-family: var(--sm-font) !important;
  border-color: var(--sm-accent) !important;
}
input, select, textarea {
  background-color: var(--sm-bg) !important;
  color: var(--sm-fg) !important;
  border-color: var(--sm-border) !important;
  border-radius: var(--sm-radius) !important;
  font-family: var(--sm-font) !important;
}

.bg-white, .bg-zinc-50, .bg-gray-50, .bg-stone-50,
.bg-slate-50, .bg-neutral-50 {
  background-color: var(--sm-bg) !important;
}
.bg-zinc-100, .bg-gray-100, .bg-stone-100, .bg-slate-100, .bg-neutral-100 {
  background-color: var(--sm-muted) !important;
  opacity: 0.15;
}
.bg-zinc-900, .bg-gray-900, .bg-stone-900, .bg-slate-900, .bg-neutral-900, .bg-black {
  background-color: var(--sm-fg) !important;
}
.text-zinc-900, .text-gray-900, .text-stone-900,
.text-slate-900, .text-neutral-900, .text-black {
  color: var(--sm-fg) !important;
}
.text-zinc-500, .text-gray-500, .text-stone-500,
.text-slate-500, .text-neutral-500, .text-muted, .text-zinc-600, .text-gray-600 {
  color: var(--sm-muted) !important;
}
.border, .border-zinc-200, .border-gray-200, .border-stone-200,
.border-slate-200, .border-neutral-200 {
  border-color: var(--sm-border) !important;
}

.bg-blue-500, .bg-blue-600, .bg-blue-700,
.bg-indigo-500, .bg-indigo-600, .bg-indigo-700,
.bg-purple-500, .bg-purple-600, .bg-purple-700,
.bg-violet-500, .bg-violet-600, .bg-violet-700,
.bg-sky-500, .bg-sky-600,
.bg-cyan-500, .bg-cyan-600 {
  background-color: var(--sm-accent) !important;
  color: #ffffff !important;
}
.text-blue-500, .text-blue-600, .text-indigo-500, .text-indigo-600,
.text-purple-500, .text-purple-600, .text-violet-500, .text-violet-600 {
  color: var(--sm-accent) !important;
}
.border-blue-500, .border-blue-600, .border-indigo-500, .border-indigo-600 {
  border-color: var(--sm-accent) !important;
}

.rounded, .rounded-md, .rounded-lg, .rounded-xl, .rounded-2xl {
  border-radius: var(--sm-radius) !important;
}

.shadow, .shadow-sm, .shadow-md, .shadow-lg, .shadow-xl {
  box-shadow: var(--sm-shadow) !important;
}
`;
}

function quoteFontIfNeeded(font: string): string {
  if (!font) return "system-ui";
  if (font.startsWith('"') || font.startsWith("'")) return font;
  if (/\s/.test(font)) return `"${font}"`;
  return font;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
