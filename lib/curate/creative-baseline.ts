import { parse, type HTMLElement } from "node-html-parser";

import { sha256 } from "@/lib/generation/content-hash";
import { composeSectionCandidate } from "@/lib/generation/compose-sections";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { sealRelease } from "@/lib/html-engine";
import { escapeHtml } from "@/lib/marketing/fill";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import { buildDeterministicIntent, buildDeterministicPageCopy } from "./deterministic-page-input";
import { finalizeComposedDocument } from "./finalize-composed-document";

const PROMPT_VERSION = "creative-baseline/1.0";
const POLICY_VERSION = "ai-hybrid-policy/1.0";
const LEAF_SELECTOR = "h1,h2,h3,h4,p,li,a,button,span,figcaption,blockquote";

export interface SafeCreativeCandidate {
  readonly html: string;
  readonly title: string;
  readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  readonly filled: boolean;
  readonly appliedOps: number;
  readonly source: "baseline" | "deepseek" | "deepseek_repair";
}

export type CreativeBaselineResult =
  | { readonly ok: true; readonly candidate: SafeCreativeCandidate; readonly intent: IntentAnalysis; readonly copy: ExtractedBusinessData }
  | { readonly ok: false; readonly code: "section_inventory_unavailable" | "baseline_invalid" };

export interface CreativeBaselineDeps {
  readonly composeSection?: typeof composeSectionCandidate;
  readonly finalize?: typeof finalizeComposedDocument;
  readonly seal?: typeof sealRelease;
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
}

export interface CreativeBaselineInput {
  readonly projectId: string;
  readonly brief: string;
  readonly profileData: BusinessProfileData;
  readonly records: readonly SectionRecord[];
}

function present(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function roleCopy(role: string, copy: ExtractedBusinessData): string[] {
  const tagline = copy.tagline_es || copy.tagline_en || copy.pitch || copy.business_name;
  const features = present(copy.features.flatMap((feature) => [feature.title, feature.desc]));
  if (role === "header") return present([copy.business_name, copy.cta_primary]);
  if (role === "hero") return present([tagline, copy.pitch, copy.cta_primary, copy.cta_secondary]);
  if (role === "footer") return present([copy.business_name, copy.cta_secondary]);
  return features.length > 0 ? features : present([tagline, copy.pitch]);
}

/** Removes donor text rather than selectively patching it: every visible leaf
 * under a role gets local copy, so no template sentence can survive. */
function fillSectionLocally(section: HTMLElement, role: string, copy: ExtractedBusinessData): number {
  const values = roleCopy(role, copy);
  if (values.length === 0) return 0;
  const leaves = section.querySelectorAll(LEAF_SELECTOR)
    .filter((node) => node.querySelector(LEAF_SELECTOR) === null);
  let applied = 0;
  for (let index = 0; index < leaves.length; index += 1) {
    const text = values[index % values.length] ?? copy.business_name;
    if (!text) continue;
    leaves[index].set_content(escapeHtml(text));
    applied += 1;
  }
  return applied;
}

function fillLocally(html: string, copy: ExtractedBusinessData): { html: string; appliedOps: number } {
  const document = parse(html);
  let appliedOps = 0;
  for (const section of document.querySelectorAll("[data-openlen-role]")) {
    appliedOps += fillSectionLocally(section, section.getAttribute("data-openlen-role") ?? "", copy);
  }
  return { html: document.toString(), appliedOps };
}

const INVENTORY_CODES = new Set([
  "section_inventory_stale", "section_fragment_unavailable", "section_fragment_stale",
  "section_fragment_invalid", "no_eligible_sections", "section_role_coverage_failed",
]);

export async function buildCreativeBaseline(
  input: CreativeBaselineInput,
  deps: CreativeBaselineDeps = {},
): Promise<CreativeBaselineResult> {
  const intent = buildDeterministicIntent(input.brief);
  const copy = buildDeterministicPageCopy(input.brief, intent);
  if (input.records.length === 0) return { ok: false, code: "section_inventory_unavailable" };

  // Provider-free by construction: none of composeSectionCandidate's paid seams
  // (generateMissing, adaptTemplateSkeleton, the Gemini fill) are handed down.
  const composed = await (deps.composeSection ?? composeSectionCandidate)({
    route: "section_composition",
    projectId: input.projectId,
    intent,
    intentHash: sha256(JSON.stringify(intent)),
    records: input.records,
    copy,
    brand: { accent: input.profileData?.brand?.accent ?? null },
  }, {
    beforeCreative: async () => false,
  });
  if (!composed.ok) {
    return { ok: false, code: INVENTORY_CODES.has(composed.reasonCode) ? "section_inventory_unavailable" : "baseline_invalid" };
  }

  const filled = fillLocally(composed.html, copy);
  const title = present([copy.business_name, copy.hero_keyword])[0]
    ?? (intent.language === "es" ? "Nuevo Proyecto" : "New Project");
  const finalized = (deps.finalize ?? finalizeComposedDocument)({
    html: filled.html,
    profileData: input.profileData,
    title,
  });
  if (!finalized.ok) return { ok: false, code: "baseline_invalid" };
  const sealed = (deps.seal ?? sealRelease)(finalized.html);
  if (!sealed.sealed) return { ok: false, code: "baseline_invalid" };
  const rendered = await (deps.render ?? (async () => ({ mobileOverflow: false, invalidGeometry: false })))(sealed.html);
  // Weak typography is an improvement signal for the sandbox, not a safety abort.
  if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return { ok: false, code: "baseline_invalid" };

  return {
    ok: true,
    intent,
    copy,
    candidate: {
      html: sealed.html,
      title,
      filled: filled.appliedOps > 0,
      appliedOps: filled.appliedOps,
      source: "baseline",
      visualEngine: {
        schemaVersion: "visual-engine-project/1.0",
        route: "section_composition",
        templateId: null,
        creativeDirection: composed.creativeDirection,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        contractVersion: "creative-direction/1.0",
        compositionManifest: composed.manifest,
      },
    },
  };
}
