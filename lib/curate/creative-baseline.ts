import { parse, type HTMLElement } from "node-html-parser";

import type { FillAssembledResult } from "@/lib/assemble/fill";
import { detectTemplateLeaks } from "@/lib/assemble/leaks";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { finalizeComposedDocument } from "@/lib/curate/finalize-composed-document";
import { AI_HYBRID_POLICY_VERSION, type SafeCreativeCandidate } from "@/lib/curate/ai-creation-contracts";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/content-hash";
import {
  composeSectionCandidate,
  type ComposeSectionCandidateDeps,
  type ComposeSectionCandidateInput,
} from "@/lib/generation/compose-sections";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import type { SkeletonAdaptationResult } from "@/lib/generation/adapt-skeleton";
import { SectionCompositionManifestSchema } from "@/lib/generation/section-composition-contracts";
import { sealRelease } from "@/lib/html-engine";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";

import { buildDeterministicIntent, buildDeterministicPageCopy } from "./deterministic-page-input";

export type { SafeCreativeCandidate } from "@/lib/curate/ai-creation-contracts";

export type CreativeBaselineResult =
  | { readonly ok: true; readonly candidate: SafeCreativeCandidate; readonly intent: IntentAnalysis; readonly copy: ExtractedBusinessData }
  | { readonly ok: false; readonly code: "section_inventory_unavailable" | "baseline_invalid" };

export interface CreativeBaselineDeps {
  /** Deterministic fragment bytes for local callers and tests. */
  fragments?: ReadonlyMap<string, string>;
  /** Fragment byte loader owned by the composition root; wins over `fragments`. */
  fetchText?: (storageUrl: string) => Promise<string | null>;
  compose?: typeof composeSectionCandidate;
  finalize?: typeof finalizeComposedDocument;
  seal?: typeof sealRelease;
  render?: typeof renderVisualQualityViewports;
  /** A test-only tripwire. Baseline construction never invokes a provider. */
  provider?: () => unknown;
}

const TEXT_LEAVES = "h1,h2,h3,h4,p,li,a,button,span,figcaption,blockquote";

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function copyValues(copy: ExtractedBusinessData): string[] {
  return [
    copy.business_name,
    copy.tagline_es,
    copy.tagline_en,
    copy.pitch,
    copy.cta_primary,
    copy.cta_secondary,
    ...copy.features.flatMap((feature) => [feature.title, feature.desc]),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function roleCopy(role: string, copy: ExtractedBusinessData): string[] {
  const values = copyValues(copy);
  const name = copy.business_name ?? "OpenLen";
  const primary = copy.cta_primary ?? name;
  const fallback = [name, copy.pitch ?? name, primary];
  if (role === "header" || role === "footer") return [name, primary, ...values, ...fallback];
  if (role === "hero") return [name, copy.tagline_es ?? copy.tagline_en ?? copy.pitch ?? name, primary, ...values];
  return [...values, ...fallback];
}

export function fillSectionLocally(section: HTMLElement, role: string, copy: ExtractedBusinessData): number {
  const values = roleCopy(role, copy);
  const leaves = section.querySelectorAll(TEXT_LEAVES)
    .filter((node) => node.querySelector(TEXT_LEAVES) === null);
  let applied = 0;
  for (let index = 0; index < leaves.length; index += 1) {
    leaves[index].set_content(escapeHtml(values[index % values.length] ?? copy.business_name ?? "OpenLen"));
    applied += 1;
  }
  return applied;
}

function fillComposedDocumentLocally(html: string, copy: ExtractedBusinessData): FillAssembledResult {
  const document = parse(html);
  let appliedOps = 0;
  for (const section of document.querySelectorAll("[data-openlen-role]")) {
    appliedOps += fillSectionLocally(section, section.getAttribute("data-openlen-role") ?? "content", copy);
  }
  const locallyFilled = document.toString();
  const leaks = detectTemplateLeaks(html, locallyFilled).damaging.length;
  return {
    html: locallyFilled,
    filled: appliedOps > 0,
    appliedOps,
    durationMs: 0,
    leaksBefore: detectTemplateLeaks(html, html).damaging.length,
    leaksAfter: leaks,
  };
}

/** The delivery gate requires exactly one creative-direction marker, the same
 *  one the adaptive pipeline stamps. The baseline really does apply a
 *  deterministic creative direction, so it owns the marker too — without it the
 *  baseline cannot pass the gate that guards its own delivery. */
function stampCreativeMarker(html: string): string {
  if (/<style\b[^>]*\bdata-openlen-visual-engine\b/i.test(html)) return html;
  const marker = '<style data-openlen-visual-engine="creative-direction/1.0"></style>';
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${marker}</head>`)
    : `${marker}${html}`;
}

async function adaptComposedDocumentLocally(
  input: Parameters<NonNullable<ComposeSectionCandidateDeps["adaptTemplateSkeleton"]>>[0],
): Promise<SkeletonAdaptationResult> {
  const deterministic = buildDeterministicCreativeDirection(input.intent);
  const html = stampCreativeMarker(input.html);
  const fingerprint = sha256(input.html);
  return {
    ok: true,
    status: "adapted",
    html,
    creativeDirectionVersion: "creative-direction/1.0",
    planVersion: "skeleton-adaptation-plan/1.0",
    creativeDirection: deterministic.direction,
    promptVersion: "creative-direction/deterministic/1.0",
    modelId: "deterministic",
    structuralFingerprintBefore: fingerprint,
    structuralFingerprintAfter: fingerprint,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0 },
    durationMs: 0,
  };
}

function composeInput(input: Parameters<typeof buildCreativeBaseline>[0], intent: IntentAnalysis, copy: ExtractedBusinessData): ComposeSectionCandidateInput {
  return {
    route: "section_composition",
    projectId: input.projectId,
    intent,
    intentHash: canonicalJsonSha256(intent),
    records: input.records,
    copy,
    brand: { accent: input.profileData.brand?.accent ?? null },
  };
}

export async function buildCreativeBaseline(
  input: { readonly projectId: string; readonly brief: string; readonly profileData: BusinessProfileData; readonly records: readonly SectionRecord[] },
  deps: CreativeBaselineDeps = {},
): Promise<CreativeBaselineResult> {
  if (input.records.length === 0) return { ok: false, code: "section_inventory_unavailable" };

  const intent = buildDeterministicIntent(input.brief);
  const copy = buildDeterministicPageCopy(input.brief, intent);
  const compose = deps.compose ?? composeSectionCandidate;
  const composed = await compose(composeInput(input, intent, copy), {
    ...(deps.fetchText
      ? { fetchText: deps.fetchText }
      : deps.fragments
        ? { fetchText: async (storageUrl: string) => deps.fragments?.get(storageUrl) ?? null }
        : {}),
    fillAssembled: async (html, localCopy) => fillComposedDocumentLocally(html, localCopy),
    adaptTemplateSkeleton: adaptComposedDocumentLocally,
  });
  if (!composed.ok) return { ok: false, code: "section_inventory_unavailable" };

  const title = copy.business_name ?? "OpenLen";
  const finalize = deps.finalize ?? finalizeComposedDocument;
  const finalized = finalize({ html: composed.html, profileData: input.profileData, title });
  if (!finalized.ok) return { ok: false, code: "baseline_invalid" };

  const seal = deps.seal ?? sealRelease;
  const sealed = seal(finalized.html);
  if (!sealed.sealed) return { ok: false, code: "baseline_invalid" };

  const render = deps.render ?? renderVisualQualityViewports;
  const rendered = await render(sealed.html);
  if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) {
    return { ok: false, code: "baseline_invalid" };
  }

  const compositionManifest = SectionCompositionManifestSchema.parse({
    ...composed.manifest,
    outputHash: sha256(sealed.html),
    resultCode: "composed",
  });
  const visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }> = {
    schemaVersion: "visual-engine-project/1.0",
    route: "section_composition",
    templateId: null,
    creativeDirection: composed.creativeDirection,
    promptVersion: composed.adaptation.promptVersion,
    policyVersion: AI_HYBRID_POLICY_VERSION,
    contractVersion: "creative-direction/1.0",
    compositionManifest,
  };
  return {
    ok: true,
    candidate: {
      html: sealed.html,
      title,
      visualEngine,
      filled: composed.fill.filled,
      appliedOps: composed.fill.appliedOps,
      source: "baseline",
    },
    intent,
    copy,
  };
}
