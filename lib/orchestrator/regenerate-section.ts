import { randomUUID } from "node:crypto";
import { createBudget } from "@/lib/budget";
import { createRecorder } from "@/lib/witness/recorder";
import { regenerateSectionCopy } from "./copy";
import { generateHtml } from "./html";
import type {
  Copy,
  CostBreakdown,
  GeneratedImage,
  Plan,
} from "./types";
import { DEFAULT_PALETTE, type StepContext } from "./_shared";

// ─────────────────────────────────────────────────────────────────────────────
// Single-section regeneration.
//
// Re-runs the copy step for ONE section (optionally with an additional
// user instruction), splices the new text into the existing copy, then
// re-runs the html step on the spliced copy. Images and the rest of the
// page are preserved.
//
// Returns the new copy + html + css + this regen's cost so the client can
// merge them into its current page state.
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateSectionInput {
  brief: string;
  plan: Plan;
  copy: Copy;
  images: GeneratedImage[];
  sectionId: string;
  additionalInstruction?: string;
}

export interface RegenerateSectionResult {
  html: string;
  css: string;
  copy: Copy;
  cost: CostBreakdown;
  generationId: string;
}

export async function regenerateSection(
  input: RegenerateSectionInput,
): Promise<RegenerateSectionResult> {
  const generationId = `regen-${randomUUID()}`;
  const recorder = createRecorder(generationId);
  // Generous cap — single-section regen is two model calls (copy + html)
  // bounded around $0.03 worst case.
  const budget = createBudget({ cap: 0.5 });

  const ctx: StepContext = {
    brief: input.brief,
    generationId,
    recorder,
    budget,
    fastPath: false,
    // Regenerate doesn't currently know which palette the original generation
    // used (Session 1 scope — intent isn't plumbed through this path).
    // Default to mono-dark; the page already has its own CSS variables from
    // the original render, so the master prompt's tokens act as a stylistic
    // anchor rather than a strict swap. Session 4 will thread intent through.
    palette: DEFAULT_PALETTE,
  };

  const newSectionCopy = await regenerateSectionCopy(ctx, {
    plan: input.plan,
    copy: input.copy,
    sectionId: input.sectionId,
    additionalInstruction: input.additionalInstruction,
  });

  const splicedCopy: Copy = {
    sectionTexts: input.copy.sectionTexts.map((s) =>
      s.sectionId === input.sectionId ? newSectionCopy : s,
    ),
  };

  // Re-run html on the spliced copy. The same prompt + image placeholders are
  // used, so existing images stay wired up via {{HERO_IMAGE}} / {{IMG_<id>}}.
  const htmlOutput = await generateHtml(ctx, input.plan, splicedCopy);

  // Re-assemble: swap image placeholders for the existing image URLs.
  let html = htmlOutput.html;
  const hero = input.images.find((i) => i.purpose === "hero");
  if (hero) {
    html = html.replaceAll("{{HERO_IMAGE}}", hero.url);
  } else {
    html = html.replace(/<img[^>]*\{\{HERO_IMAGE\}\}[^>]*\/?>/gi, "");
  }
  for (const img of input.images) {
    if (img.purpose === "hero") continue;
    html = html.replaceAll(`{{IMG_${img.id}}}`, img.url);
  }
  html = html.replace(/\{\{(HERO_IMAGE|IMG_[A-Za-z0-9_-]+)\}\}/g, "");
  html = html.replace(/<img\b[^>]*\ssrc\s*=\s*(["'])\s*\1[^>]*>/gi, "");

  return {
    html,
    css: htmlOutput.css,
    copy: splicedCopy,
    cost: budget.breakdown(),
    generationId,
  };
}
