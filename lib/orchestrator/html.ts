import { z } from "zod";
import type { ChatMessage } from "@/lib/together/client";
import type { Copy, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { refineHtml } from "./refine";

const SYSTEM_PROMPT = `You generate production-ready HTML and plain CSS for a single landing page.

Output a SINGLE JSON object — no markdown, no commentary:
{ "html": "<main>...</main>", "css": "..." }

HTML rules:
- Wrap everything in a single <main> element. Inside <main>, each planned section is a <section class="<kind>"> element where <kind> is "hero", "features", "social_proof", etc., matching the plan's section.kind. The footer is a <footer class="footer"> element after </main> closes — but include it INSIDE <main> for this generator (the assembler handles that).
- Use semantic HTML5: <section>, <article>, <header>, <h1>/<h2>/<h3>, <p>, <ul>/<li>, <a>, <img>.
- The first <section class="hero"> MUST contain exactly one <img> with src="{{HERO_IMAGE}}" and a meaningful alt attribute. Assembly swaps the placeholder for a real URL.
- Other image placeholders are src="{{IMG_<id>}}" using an id THAT EXISTS in the plan's imagePrompts list. Each <img> MUST have a non-empty alt attribute.
- NEVER emit <img src=""> or <img src="#">. NEVER reference an image id that is not in imagePrompts. If the copy mentions a logo, brand mark, avatar, or other visual you don't have an imagePrompt for, render it as styled text instead — for example: <span class="logo-pill">Brewdog</span> styled in CSS. This is the rule for client logos, partner marks, team photos, and anything else the brief describes but the plan didn't generate.
- Every <button> or icon-only <a> must have an aria-label.
- All interactive elements use <a href="..."> or <button type="button">. No JS handlers.
- No <script> tags. No external CDN <link> or <script>. No inline event handlers.
- Mobile-first responsive layout. Plan for breakpoints around 640px, 1024px.

CSS rules:
- Plain CSS (NOT Tailwind). Target the classes you set in the HTML. No CSS framework references.
- Use CSS custom properties for the palette (--brand, --bg, --fg, --muted) so a designer can swap them.
- Mobile-first: base styles for narrow viewports, @media (min-width: 640px) and (min-width: 1024px) for larger.
- Use modern features: flexbox, grid, clamp() for fluid type, gap for spacing.
- Match the plan's style direction (palette, typography, density, mood).
- Provide hover/focus states on links and buttons for accessibility.
- Reasonable defaults: html { box-sizing: border-box; } *,*:before,*:after { box-sizing: inherit; } body { margin: 0; }.

The HTML and CSS together must render a complete, attractive page when injected into a basic HTML document with no other styles.`;

const HtmlOutputSchema = z.object({
  html: z.string().min(50),
  css: z.string().min(20),
});

export interface HtmlOutput {
  html: string;
  css: string;
}

function buildMessages(plan: Plan, copy: Copy): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT, cache: true },
    {
      role: "user",
      content: `Plan JSON:\n${JSON.stringify(plan, null, 2)}\n\nCopy JSON:\n${JSON.stringify(copy, null, 2)}`,
    },
  ];
}

export async function generateHtml(
  ctx: StepContext,
  plan: Plan,
  copy: Copy,
): Promise<HtmlOutput> {
  return runTextStep<HtmlOutput>(ctx, {
    step: "html",
    buildMessages: () => buildMessages(plan, copy),
    mockKey: "html",
    callOptions: { responseFormat: "json", temperature: 0.4, maxTokens: 8192 },
    progressDetail: "Generating HTML and CSS",
    fallbackNote:
      "Quality gate failed on primary HTML output; escalating to DeepSeek V4 Pro for a hard fix.",
    validate: (content) => {
      const parsed = parseJson<unknown>(content, "html");
      const out = HtmlOutputSchema.parse(parsed);
      assertHtmlQuality(out.html);
      return out;
    },
    lastResort: async (lastContent, lastError, ctx) => {
      const refined = await refineHtml(ctx, lastContent, lastError);
      // Re-run quality gates on the refined output. If refine couldn't fix it
      // either, the throw propagates and the step fails.
      assertHtmlQuality(refined.html);
      return refined;
    },
  });
}

// Quality gates run AFTER schema parse. Any throw here triggers the fallback
// chain. Keep checks cheap and high-precision (false positives waste budget).
function assertHtmlQuality(html: string): void {
  const trimmed = html.trim();

  // Must close with </main> — catches truncation.
  if (!/<\/main>\s*$/.test(trimmed)) {
    throw new Error("html: missing closing </main> (likely truncated)");
  }

  // Must open with <main>.
  if (!/^<main[\s>]/.test(trimmed)) {
    throw new Error("html: must start with <main>");
  }

  // No <script> tags — security + iframe sandbox compliance.
  if (/<script[\s>]/i.test(html)) {
    throw new Error("html: <script> tags are not permitted");
  }

  // No external resource loads.
  if (/<(link|script)[^>]+src=|<link[^>]+href=["']https?:/i.test(html)) {
    throw new Error("html: external CDN references are not permitted");
  }

  // Tag balance — rough heuristic, ignores void elements.
  const open = (html.match(/<([a-z][a-z0-9]*)(\s[^>]*)?>/gi) ?? []).filter(
    (t) => !/<(br|hr|img|input|meta|link|source|wbr|area|base|col|embed|param|track)\b/i.test(t),
  ).length;
  const close = (html.match(/<\/[a-z][a-z0-9]*>/gi) ?? []).length;
  if (Math.abs(open - close) > 2) {
    throw new Error(
      `html: tag balance off (${open} open vs ${close} close) — likely malformed`,
    );
  }

  // Every <img> must have an alt attribute (accessibility gate).
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = imgs.filter((tag) => !/\salt\s*=/i.test(tag));
  if (missingAlt.length > 0) {
    throw new Error(`html: ${missingAlt.length} <img> tag(s) missing alt attribute`);
  }

  // Every <img> must have a non-empty src. Catches the agency-style bug where
  // the model invents <img src="" alt="Brand logo"> entries for assets it has
  // no imagePrompt for. The system prompt instructs to render those as styled
  // text instead.
  const emptySrc = imgs.filter((tag) => {
    const m = tag.match(/\ssrc\s*=\s*(["'])([^"']*)\1/i);
    if (!m) return true; // missing src entirely also disqualifies
    const value = m[2].trim();
    return value === "" || value === "#";
  });
  if (emptySrc.length > 0) {
    throw new Error(
      `html: ${emptySrc.length} <img> tag(s) with empty/placeholder src — render brand marks as styled text instead`,
    );
  }

  // Hero image placeholder must be present.
  if (!html.includes("{{HERO_IMAGE}}")) {
    throw new Error("html: hero section missing {{HERO_IMAGE}} placeholder");
  }
}
