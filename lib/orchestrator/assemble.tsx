import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getBlock, type BlockId } from "@/lib/blocks/_registry";
import { paletteToTokens } from "@/lib/blocks/palette-to-tokens";
import type {
  CostBreakdown,
  FilledBlock,
  GeneratedImage,
  Intent,
  LandingPage,
  Plan,
} from "./types";
import type { StepContext } from "./_shared";
import { emit } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Assemble step — DETERMINISTIC, NO LLM CALL.
//
// Takes the planned block sequence, filled slots, and generated images, and
// produces a complete HTML document by rendering each block component via
// `renderToStaticMarkup`. The output is a self-contained string:
//
//   - Tailwind CSS Play CDN provides the utility classes (the blocks ship
//     with Tailwind utilities baked into their JSX).
//   - A `:root` block sets CSS variables for the chosen palette so the body
//     bg/fg matches the blocks rendered below.
//   - Each block is wrapped with `data-section-id` + `data-block-id` so the
//     iframe overlay can target it for regenerate-section.
//
// Cost: $0. The synthetic witness record below documents the deterministic
// assembly so the recording stays complete-looking ("every step produced a
// record") even though no model was called.
// ─────────────────────────────────────────────────────────────────────────────

export interface AssembleInput {
  ctx: StepContext;
  brief: string;
  generationId: string;
  intent: Intent;
  plan: Plan;
  filledBlocks: FilledBlock[];
  images: GeneratedImage[];
  cost: CostBreakdown;
  witnessPath: string;
  adaptiveFastPath: boolean;
}

export async function assemble(input: AssembleInput): Promise<LandingPage> {
  emit(input.ctx, {
    type: "progress",
    step: "assemble",
    status: "started",
    details: "Composing final HTML deterministically",
  });

  const tokens = paletteToTokens(input.ctx.palette.name);
  const ordered = [...input.filledBlocks].sort((a, b) => a.index - b.index);
  const hero = input.images.find((i) => i.purpose === "hero");
  const decoratives = input.images.filter((i) => i.purpose !== "hero");

  // Render each block. The first hero/* block in the sequence gets the
  // generated hero image URL injected into its image slot (if it has one).
  let heroAssigned = false;
  let decorativeCursor = 0;
  const mainSections: string[] = [];
  const footerSections: string[] = [];

  for (const filled of ordered) {
    const block = getBlock(filled.blockId);
    let slots = filled.slots;
    if (filled.blockId.startsWith("hero/") && !heroAssigned && hero) {
      slots = injectImageIntoHeroSlots(slots, hero.url, hero.prompt);
      heroAssigned = true;
    } else if (filled.blockId.startsWith("features/") && decoratives.length > 0) {
      const next = decoratives[decorativeCursor];
      if (next) {
        slots = injectImageIntoFeatureSlots(slots, next.url, next.prompt);
        decorativeCursor += 1;
      }
    }

    // The block component is typed as `BlockComponent<S>` where S is its own
    // Zod schema. We've already validated slots against that schema at fill
    // time; the cast here is safe but TypeScript can't prove it across the
    // dynamic getBlock(id) lookup.
    const Component = block.Component as React.FC<{
      slots: unknown;
      tokens: typeof tokens;
    }>;

    const raw = renderToStaticMarkup(
      React.createElement(Component, { slots, tokens }),
    );
    const tagged = injectSectionId(raw, filled.index, filled.blockId);
    // Footer blocks render their own <footer> tag and must sit outside
    // <main> for the WCAG landmark structure (one main, footer at root).
    if (filled.blockId.startsWith("footer/")) {
      footerSections.push(tagged);
    } else {
      mainSections.push(tagged);
    }
  }

  const sectionsHtml = `<main>\n${mainSections.join("\n")}\n</main>\n${footerSections.join("\n")}`;
  const title = deriveTitle(input.intent);
  const description = deriveDescription(input.intent, input.plan);

  const html = wrapDocument({
    title,
    description,
    bodyHtml: sectionsHtml,
    tokens,
  });

  // Synthetic witness record so the recording shows assemble ran. Cost zero,
  // tokens zero — the `deterministic` flag distinguishes this from LLM rows.
  await input.ctx.recorder.record({
    step: "assemble",
    decision: {
      step: "assemble",
      model: "deterministic",
      reason: "Deterministic React SSR — renderToStaticMarkup, no LLM call",
      isFallback: false,
      fallbackChain: [],
    },
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    mocked: false,
    note: `Rendered ${ordered.length} blocks; hero image ${heroAssigned ? "injected" : "none"}; ${decorativeCursor} decorative(s) injected`,
    palette: input.ctx.palette.name,
    deterministic: true,
  });

  emit(input.ctx, {
    type: "progress",
    step: "assemble",
    status: "completed",
    details: `Rendered ${ordered.length} blocks`,
    costSoFar: input.ctx.budget.total(),
  });

  return {
    html,
    css: "",
    images: input.images,
    meta: {
      title,
      description,
      generationId: input.generationId,
      generatedAt: new Date().toISOString(),
      brief: input.brief,
      intent: input.intent,
      aesthetic: input.plan.aesthetic,
      palette: input.plan.palette,
      blockSequence: input.plan.blockSequence.map((b, idx) => ({
        blockId: b.blockId,
        index: idx,
      })),
    },
    cost: input.cost,
    witnessPath: input.witnessPath,
    adaptiveFastPath: input.adaptiveFastPath,
    plan: input.plan,
    filledBlocks: ordered,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveTitle(intent: Intent): string {
  if (intent.productName) return intent.productName;
  return `${capitalize(intent.industry)} for ${intent.audience}`;
}

function deriveDescription(intent: Intent, plan: Plan): string {
  const sequenceSummary = plan.blockSequence
    .map((e) => e.blockId.split("/")[0])
    .filter((kind, idx, arr) => arr.indexOf(kind) === idx)
    .slice(0, 4)
    .join(", ");
  return `${capitalize(intent.tone)} ${intent.industry} landing page for ${intent.audience}. Sections: ${sequenceSummary}.`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// Best-effort image slot injection. The hero blocks each expose a different
// field name for their image (mockupSrc vs imageSrc); we try the known names
// in priority order and leave the original slots intact if none match.
function injectImageIntoHeroSlots(
  slots: unknown,
  url: string,
  prompt: string,
): unknown {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return slots;
  const s = slots as Record<string, unknown>;
  const updates: Record<string, string> = {};
  if ("imageSrc" in s) {
    updates.imageSrc = url;
    if ("imageAlt" in s && (!s.imageAlt || typeof s.imageAlt !== "string" || s.imageAlt.length < 4)) {
      updates.imageAlt = shortenAlt(prompt);
    }
  } else if ("mockupSrc" in s || "mockupAlt" in s) {
    updates.mockupSrc = url;
    if (!s.mockupAlt || typeof s.mockupAlt !== "string" || s.mockupAlt.length < 4) {
      updates.mockupAlt = shortenAlt(prompt);
    }
  }
  if (Object.keys(updates).length === 0) return slots;
  return { ...s, ...updates };
}

function injectImageIntoFeatureSlots(
  slots: unknown,
  url: string,
  _prompt: string,
): unknown {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return slots;
  const s = slots as Record<string, unknown>;
  // features/alternating-rows has an `items[].image.src` field. If we detect
  // that pattern, replace the first item's image src.
  if (Array.isArray(s.items)) {
    const items = s.items as Array<Record<string, unknown>>;
    if (items.length > 0 && items[0] && typeof items[0].image === "object" && items[0].image) {
      const img = items[0].image as Record<string, unknown>;
      const updatedItems = items.map((item, idx) =>
        idx === 0
          ? { ...item, image: { ...img, src: url } }
          : item,
      );
      return { ...s, items: updatedItems };
    }
  }
  return slots;
}

function shortenAlt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}...`;
}

// Inject data-section-id="block-N" + data-block-id="<id>" into the first
// section/footer/main tag of the rendered block markup. Lets the iframe
// overlay target the rendered block for /api/regenerate-section.
function injectSectionId(html: string, index: number, blockId: BlockId): string {
  const attrs = ` data-section-id="block-${index}" data-block-id="${escapeAttr(blockId)}"`;
  // Match the first opening section, footer, main, or article tag and inject
  // attributes right after the tag name. We bias to tags blocks actually use.
  const re = /<(section|footer|main|article)(\s[^>]*)?>/i;
  return html.replace(re, (_, tag: string, rest: string | undefined) => {
    return `<${tag}${attrs}${rest ?? ""}>`;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

interface WrapDocumentArgs {
  title: string;
  description: string;
  bodyHtml: string;
  tokens: ReturnType<typeof paletteToTokens>;
}

function wrapDocument(args: WrapDocumentArgs): string {
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: args.title,
    description: args.description,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(args.title)}</title>
<meta name="description" content="${escapeHtml(args.description)}" />
<meta property="og:title" content="${escapeHtml(args.title)}" />
<meta property="og:description" content="${escapeHtml(args.description)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<script src="https://cdn.tailwindcss.com"></script>
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root {
    --color-bg: ${args.tokens.bg};
    --color-surface: ${args.tokens.surface};
    --color-surface-elevated: ${args.tokens.surfaceElevated};
    --color-border: ${args.tokens.border};
    --color-border-strong: ${args.tokens.borderStrong};
    --color-text: ${args.tokens.text};
    --color-text-muted: ${args.tokens.textMuted};
    --color-text-dim: ${args.tokens.textDim};
    --color-accent: ${args.tokens.accent};
    --color-accent-hover: ${args.tokens.accentHover};
    --color-accent-fg: ${args.tokens.accentFg};
    --radius: ${args.tokens.radius};
    --shadow: ${args.tokens.shadow};
    --font-display: ${args.tokens.fontDisplay};
    --font-body: ${args.tokens.fontBody};
    --font-mono: ${args.tokens.fontMono};
  }
  html, body { background: var(--color-bg); color: var(--color-text); margin: 0; font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
  *, *::before, *::after { box-sizing: border-box; }
</style>
</head>
<body>
${args.bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
