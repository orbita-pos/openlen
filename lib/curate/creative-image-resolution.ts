import { AssetIntentSchema, type AssetResolutionSource } from "@/lib/generation/asset-contracts";
import { parseAssetGenerationBudget, type AssetGenerationBudget, type AssetPackProvider } from "@/lib/generation/asset-pack-provider";
import { resolveDomainAssetManifest } from "@/lib/generation/asset-pipeline";
import { assetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import { loadCuratedImages } from "@/lib/imagery/manifest";
import { getAssetStorage, type AssetStorage } from "@/lib/projects/assets";

const MEDIA_TYPES = new Set(["photo", "illustration", "texture"]);

export type CreativeImageResolution =
  | { readonly ok: true; readonly url: string; readonly source: AssetResolutionSource }
  | { readonly ok: false; readonly code: string };

export interface CreativeImageResolutionInput {
  readonly projectId: string;
  readonly intent: IntentAnalysis;
  readonly direction: CreativeDirection;
  readonly subject: string;
  readonly mediaType?: string;
}

export interface CreativeImageResolutionDeps {
  readonly provider: AssetPackProvider;
  readonly mode?: ReturnType<typeof assetPipelineMode>;
  readonly budget?: AssetGenerationBudget | null;
  readonly loadCuratedImages?: typeof loadCuratedImages;
  readonly fetchImpl?: typeof fetch;
  readonly storage?: AssetStorage;
  readonly resolveManifest?: typeof resolveDomainAssetManifest;
  readonly catalogVersion?: string;
}

/** The model writes prose; the asset boundary speaks taxonomy. An unslugifiable
 * subject is refused here, before anything is paid for. */
export function taxonomySubject(value: string): string | null {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(slug) ? slug : null;
}

/**
 * One optional image for one creative slot, resolved through the existing
 * domain asset pipeline (curated catalog first, generation only in hybrid).
 * Every failure is a code, never a throw: an image the page cannot get is a
 * page without that image, not a failed page.
 */
export async function resolveCreativeImage(
  input: CreativeImageResolutionInput,
  deps: CreativeImageResolutionDeps,
): Promise<CreativeImageResolution> {
  const mode = deps.mode ?? assetPipelineMode();
  if (mode !== "curated" && mode !== "hybrid") return { ok: false, code: "assets_disabled" };

  const budget = deps.budget === undefined ? parseAssetGenerationBudget(process.env) : deps.budget;
  if (!budget) return { ok: false, code: "asset_budget_unavailable" };

  const subject = taxonomySubject(input.subject);
  if (!subject) return { ok: false, code: "invalid_subject" };
  const mediaType = input.mediaType && MEDIA_TYPES.has(input.mediaType) ? input.mediaType : "photo";

  const audiences = [
    input.intent.audience.primary,
    ...input.intent.audience.secondary,
    ...(input.intent.audience.ageRange ? [input.intent.audience.ageRange] : []),
  ];

  let intents;
  try {
    intents = [AssetIntentSchema.parse({
      slotIndex: 0,
      role: "section",
      // The creative tool may never request an identity-bearing or required
      // asset: those are the only ones that can fail a page closed.
      required: false,
      identityBearing: false,
      mediaType,
      subjects: [subject],
      domains: input.intent.domains,
      audiences: [...new Set(audiences)].slice(0, 12),
      visualArchetype: input.direction.visualArchetype,
      emotionalTone: input.direction.emotionalTone,
      aspectRatio: "4:3",
      focalPoint: "center",
      alt: subject.replaceAll("_", " "),
      requiredSignals: input.direction.requiredVisualSignals,
      forbiddenSignals: input.direction.forbiddenVisualSignals,
    })];
  } catch {
    return { ok: false, code: "invalid_asset_intent" };
  }

  let resolved;
  try {
    resolved = await (deps.resolveManifest ?? resolveDomainAssetManifest)({
      intents,
      direction: input.direction,
      projectId: input.projectId,
      mode,
    }, {
      loadCuratedImages: deps.loadCuratedImages ?? loadCuratedImages,
      catalogVersion: deps.catalogVersion ?? "openlen-images/1",
      fetchImpl: deps.fetchImpl ?? fetch,
      provider: deps.provider,
      storage: deps.storage ?? getAssetStorage(),
      budget,
    });
  } catch {
    return { ok: false, code: "asset_pipeline_error" };
  }
  if (!resolved.ok) return { ok: false, code: resolved.code };

  const slot = resolved.manifest.slots[0];
  if (!slot) return { ok: false, code: "asset_slot_unavailable" };
  // A placeholder is not an image; leaving the slot as designed beats stamping
  // a grey rectangle onto a page that already looks finished.
  if (slot.resolution.source === "placeholder") return { ok: false, code: "placeholder_only" };
  return { ok: true, url: slot.resolution.url, source: slot.resolution.source };
}
