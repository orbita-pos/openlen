import { z } from "zod";
import type { ChatMessage } from "@/lib/together/client";
import type { Copy, Plan } from "./types";
import { parseJson, runTextStep, type StepContext } from "./_shared";
import { refineHtml } from "./refine";
import { buildSystemMessageForStep } from "./routing";

const HtmlOutputSchema = z.object({
  html: z.string().min(50),
  css: z.string().min(20),
});

export interface HtmlOutput {
  html: string;
  css: string;
}

function buildMessages(ctx: StepContext, plan: Plan, copy: Copy): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemMessageForStep("html", {
        palette: ctx.palette,
        plan,
      }),
      cache: true,
    },
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
    buildMessages: () => buildMessages(ctx, plan, copy),
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

  // Navbar must be present and appear before the hero section.
  const navMatch = /<header[^>]*class\s*=\s*(["'])[^"']*\bnavbar\b[^"']*\1/i.exec(html);
  if (!navMatch) {
    throw new Error("html: missing <header class=\"navbar\"> at the top of <main>");
  }
  const heroIdx = html.search(/<section[^>]*class\s*=\s*(["'])[^"']*\bhero\b[^"']*\1/i);
  if (heroIdx !== -1 && navMatch.index > heroIdx) {
    throw new Error("html: <header class=\"navbar\"> must appear before the hero section");
  }
}
