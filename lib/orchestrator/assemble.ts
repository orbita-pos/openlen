import type {
  CostBreakdown,
  GeneratedImage,
  Intent,
  LandingPage,
} from "./types";
import type { HtmlOutput } from "./html";

// ─────────────────────────────────────────────────────────────────────────────
// Assemble step.
//
// Combine the HTML/CSS, the resolved image URLs, and metadata into the final
// `LandingPage` artifact. Specifically:
//   - swap `{{HERO_IMAGE}}` / `{{IMG_<id>}}` placeholders for real URLs
//   - drop image references whose generation failed (degrade gracefully)
//   - emit metadata + cost summary
// ─────────────────────────────────────────────────────────────────────────────

export interface AssembleInput {
  brief: string;
  generationId: string;
  intent: Intent;
  html: HtmlOutput;
  images: GeneratedImage[];
  cost: CostBreakdown;
  witnessPath: string;
  adaptiveFastPath: boolean;
}

export function assemble(input: AssembleInput): LandingPage {
  const hero = input.images.find((i) => i.purpose === "hero");
  let html = input.html.html;

  if (hero) {
    html = html.replaceAll("{{HERO_IMAGE}}", hero.url);
  } else {
    html = stripImageTagsWithPlaceholder(html, "{{HERO_IMAGE}}");
  }

  for (const img of input.images) {
    if (img.purpose === "hero") continue;
    html = html.replaceAll(`{{IMG_${img.id}}}`, img.url);
  }
  html = stripUnresolvedPlaceholders(html);

  const title = deriveTitle(input);
  const description = deriveDescription(input);

  return {
    html,
    css: input.html.css,
    images: input.images,
    meta: {
      title,
      description,
      generationId: input.generationId,
      generatedAt: new Date().toISOString(),
      brief: input.brief,
      intent: input.intent,
    },
    cost: input.cost,
    witnessPath: input.witnessPath,
    adaptiveFastPath: input.adaptiveFastPath,
  };
}

function deriveTitle(input: AssembleInput): string {
  if (input.intent.productName) return input.intent.productName;
  return `${capitalize(input.intent.industry)} for ${input.intent.audience}`;
}

function deriveDescription(input: AssembleInput): string {
  return `${capitalize(input.intent.tone)} ${input.intent.industry} landing page for ${input.intent.audience}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripImageTagsWithPlaceholder(html: string, placeholder: string): string {
  // Remove a whole <img ... src="{{...}}" ...> element when its src placeholder
  // never got resolved (e.g. image generation failed).
  const re = new RegExp(`<img[^>]*${escapeRegex(placeholder)}[^>]*\\/?>`, "gi");
  return html.replace(re, "");
}

function stripUnresolvedPlaceholders(html: string): string {
  // Final pass: drop any remaining {{IMG_*}} or {{HERO_IMAGE}} tokens so they
  // don't appear in the rendered page if assembly missed something.
  return html.replace(/\{\{(HERO_IMAGE|IMG_[A-Za-z0-9_-]+)\}\}/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
