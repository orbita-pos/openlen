import { fillAssembled, type FillAssembledResult } from "@/lib/assemble/fill";
import { seedBrandIntoHtml, profileMeta } from "@/lib/business-profiles/seed-html";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { sanitizeForPublish } from "@/lib/html-engine";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import { getTemplateHtml } from "@/lib/templates/store";

export interface FillAndNormalizeCuratedTemplateInput {
  templateId: string;
  copy: ExtractedBusinessData;
  onStage?: (stage: string) => void;
  /** Preserves Quick's immediate raw preview before the fill starts. */
  onTemplateLoaded?: (html: string) => void;
}

export type FillAndNormalizeCuratedTemplateResult =
  | ({
      ok: true;
      templateId: string;
      templateHtml: string;
      normalizedHtml: string;
    } & Omit<FillAssembledResult, "html">)
  | { ok: false; kind: "template-unavailable"; templateId: string };

export interface FillAndNormalizeCuratedTemplateDeps {
  getTemplateHtml?: typeof getTemplateHtml;
  fillAssembled?: typeof fillAssembled;
  normalizeBornCanonical?: typeof normalizeBornCanonical;
}

/** Loads and fills one template without applying brand, metadata or publish sanitation. */
export async function fillAndNormalizeCuratedTemplate(
  input: FillAndNormalizeCuratedTemplateInput,
  deps: FillAndNormalizeCuratedTemplateDeps = {},
): Promise<FillAndNormalizeCuratedTemplateResult> {
  const templateHtml = await (deps.getTemplateHtml ?? getTemplateHtml)(input.templateId);
  if (templateHtml === null) {
    return { ok: false, kind: "template-unavailable", templateId: input.templateId };
  }
  input.onTemplateLoaded?.(templateHtml);

  const fill = await (deps.fillAssembled ?? fillAssembled)(templateHtml, input.copy, {
    onStage: input.onStage,
  });
  const normalizedHtml = (deps.normalizeBornCanonical ?? normalizeBornCanonical)(fill.html);
  const { html: _filledHtml, ...fillData } = fill;
  return {
    ok: true,
    templateId: input.templateId,
    templateHtml,
    normalizedHtml,
    ...fillData,
  };
}

export interface FinalizeCuratedDocumentInput {
  normalizedHtml: string;
  profileData: BusinessProfileData;
  title: string;
  brandRecolor: boolean;
}

export type FinalizeCuratedDocumentResult =
  | { ok: true; html: string }
  | { ok: false; kind: "editor-marker-leak" };

export interface FinalizeCuratedDocumentDeps {
  seedBrandIntoHtml?: typeof seedBrandIntoHtml;
  ensurePageMeta?: typeof ensurePageMeta;
  sanitizeForPublish?: typeof sanitizeForPublish;
}

/** Applies the shared profile/meta/publish boundary to an already normalized document. */
export function finalizeCuratedDocument(
  input: FinalizeCuratedDocumentInput,
  deps: FinalizeCuratedDocumentDeps = {},
): FinalizeCuratedDocumentResult {
  const seeded = (deps.seedBrandIntoHtml ?? seedBrandIntoHtml)(
    input.normalizedHtml,
    input.profileData,
    { recolor: input.brandRecolor },
  );
  const withMeta = (deps.ensurePageMeta ?? ensurePageMeta)(seeded, {
    title: input.title,
    ...profileMeta(input.profileData),
    replaceStaleMeta: true,
  });
  const sanitized = (deps.sanitizeForPublish ?? sanitizeForPublish)(withMeta);
  if (sanitized.html === null) return { ok: false, kind: "editor-marker-leak" };
  return { ok: true, html: sanitized.html };
}
