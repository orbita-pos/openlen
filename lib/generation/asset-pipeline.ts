import { createHash } from "node:crypto";

import {
  resolveCuratedAssetPack,
  type CuratedAssetPackResult,
  type ResolveCuratedAssetPackInput,
  type CuratedAssetDependencies,
} from "@/lib/generation/asset-catalog";
import {
  AssetIntentSchema,
  AssetManifestSchema,
  AssetResolutionSchema,
  AssetResolutionTraceSchema,
  type AssetIntent,
  type AssetManifest,
  type AssetResolution,
  type AssetResolutionTrace,
} from "@/lib/generation/asset-contracts";
import { validateGeneratedImage, type ValidatedImage } from "@/lib/generation/asset-image-validation";
import type {
  AssetGenerationBudget,
  AssetPackProvider,
  AssetPackResult,
} from "@/lib/generation/asset-pack-provider";
import { CreativeDirectionSchema, type CreativeDirection } from "@/lib/generation/creative-contracts";
import type { CuratedImage } from "@/lib/imagery/manifest";
import type { AssetStorage } from "@/lib/projects/assets";

const PLACEHOLDER_URL = "/openlen-assets/placeholders/neutral-abstract.svg";
const PLACEHOLDER_CHECKSUM = "sha256:5391abe6d8d829be1419f95ddd0c7e73c1564df2d3e354d843fd2480e73c676a";
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export type AssetPipelineMode = "curated" | "hybrid";

export interface ResolveDomainAssetManifestInput {
  intents: readonly AssetIntent[];
  direction: CreativeDirection;
  projectId: string;
  mode: AssetPipelineMode;
}

type ResolveCurated = (
  input: ResolveCuratedAssetPackInput,
  deps: CuratedAssetDependencies,
) => Promise<CuratedAssetPackResult>;

export interface AssetPipelineDependencies {
  loadCuratedImages(): Promise<readonly CuratedImage[]>;
  catalogVersion: string;
  fetchImpl: CuratedAssetDependencies["fetchImpl"];
  provider: AssetPackProvider;
  storage: Pick<AssetStorage, "put">;
  budget: AssetGenerationBudget;
  resolveCurated?: ResolveCurated;
  now?: () => number;
}

export type AssetPipelineResult =
  | { ok: true; manifest: AssetManifest; trace: AssetResolutionTrace }
  | {
      ok: false;
      code: "required_asset_unavailable" | "asset_slot_unavailable" | "provider_error" | "storage_error" | "invalid_asset";
      slotIndex?: number;
      trace: AssetResolutionTrace;
    };

interface GeneratedAssignment {
  intent: AssetIntent;
  resolution: AssetResolution;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function isSafeCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validUsage(value: unknown): boolean {
  return hasExactKeys(value, ["inputTokens", "outputTokens", "cachedTokens", "thinkingTokens"])
    && isSafeCounter(value.inputTokens)
    && isSafeCounter(value.outputTokens)
    && isSafeCounter(value.cachedTokens)
    && isSafeCounter(value.thinkingTokens);
}

function validProviderSuccessTelemetry(value: unknown): boolean {
  return hasExactKeys(value, ["ok", "provider", "modelId", "images", "estimatedCostMicromxn", "durationMs"], ["usage"])
    && value.ok === true
    && typeof value.provider === "string"
    && PROVIDER_ID.test(value.provider)
    && typeof value.modelId === "string"
    && MODEL_ID.test(value.modelId)
    && Array.isArray(value.images)
    && isSafeCounter(value.estimatedCostMicromxn)
    && isSafeCounter(value.durationMs)
    && (value.usage === undefined || validUsage(value.usage));
}

function validProviderFailureTelemetry(value: unknown): boolean {
  return hasExactKeys(value, ["ok", "code", "provider", "modelId", "durationMs"], ["usage"])
    && value.ok === false
    && typeof value.code === "string"
    && ["provider_unavailable", "provider_timeout", "provider_error", "provider_blocked", "invalid_provider_response", "invalid_image", "budget_exhausted"].includes(value.code)
    && typeof value.provider === "string"
    && PROVIDER_ID.test(value.provider)
    && typeof value.modelId === "string"
    && MODEL_ID.test(value.modelId)
    && isSafeCounter(value.durationMs)
    && (value.usage === undefined || validUsage(value.usage));
}

function normalizedTaxonomy(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function consistencyGroup(
  intents: readonly AssetIntent[],
  direction: CreativeDirection,
  curated: CuratedAssetPackResult,
): AssetManifest["consistencyGroup"] {
  const mediaType = curated.consistencyGroup?.mediaType ?? intents[0].mediaType;
  const artDirection = normalizedTaxonomy(curated.consistencyGroup?.artDirection ?? direction.imagery.artDirection, "domain_asset");
  const styleLock = normalizedTaxonomy(
    curated.consistencyGroup?.styleLock ?? `${direction.visualArchetype}_${direction.imagery.artDirection}`,
    "domain_asset",
  );
  const idHash = createHash("sha256").update(canonicalJson({ mediaType, artDirection, styleLock })).digest("hex").slice(0, 16);
  return { id: `asset-pack-${idHash}`, mediaType, artDirection, paletteHints: [], styleLock };
}

function trace(
  values: Partial<AssetResolutionTrace> & Pick<AssetResolutionTrace, "resultCode">,
): AssetResolutionTrace {
  return AssetResolutionTraceSchema.parse({
    schemaVersion: "asset-resolution-trace/1.0",
    manifestId: null,
    consistencyGroupCount: 0,
    curatedCount: 0,
    generatedCount: 0,
    abstractCount: 0,
    placeholderCount: 0,
    requiredUnresolvedCount: 0,
    rejectionCounts: {},
    provider: null,
    modelId: null,
    promptSha256: [],
    estimatedCostMicromxn: 0,
    durationMs: 0,
    ...values,
  });
}

function providerTraceCode(result: Extract<AssetPackResult, { ok: false }>): AssetResolutionTrace["resultCode"] {
  switch (result.code) {
    case "provider_unavailable": return "provider_unavailable";
    case "provider_timeout": return "provider_timeout";
    case "provider_blocked": return "provider_blocked";
    case "invalid_provider_response":
    case "invalid_image": return "invalid_provider_output";
    case "budget_exhausted": return "budget_exhausted";
    case "provider_error": return "internal_error";
  }
}

function validInputs(input: ResolveDomainAssetManifestInput): { intents: AssetIntent[]; direction: CreativeDirection } | null {
  if (!PROJECT_ID.test(input.projectId) || (input.mode !== "curated" && input.mode !== "hybrid")) return null;
  const direction = CreativeDirectionSchema.safeParse(input.direction);
  if (!direction.success || input.intents.length < 1 || input.intents.length > 12) return null;
  const intents: AssetIntent[] = [];
  const indexes = new Set<number>();
  for (const candidate of input.intents) {
    const parsed = AssetIntentSchema.safeParse(candidate);
    if (!parsed.success || indexes.has(parsed.data.slotIndex)) return null;
    indexes.add(parsed.data.slotIndex);
    intents.push(parsed.data);
  }
  intents.sort((left, right) => left.slotIndex - right.slotIndex);
  return { intents, direction: direction.data };
}

function curatedResolution(assignment: CuratedAssetPackResult["assignments"][number]): AssetResolution {
  return {
    source: "curated",
    slotIndex: assignment.slotIndex,
    assetId: assignment.assetId,
    url: assignment.url,
    mimeType: assignment.mimeType,
    checksum: assignment.checksum,
    width: assignment.width,
    height: assignment.height,
    domainMatch: true,
    audienceMatch: true,
    styleMatch: true,
    provenance: assignment.provenance,
  };
}

function placeholderResolution(intent: AssetIntent): AssetResolution {
  return {
    source: "placeholder",
    slotIndex: intent.slotIndex,
    assetId: "neutral-abstract-v1",
    url: PLACEHOLDER_URL,
    mimeType: "image/svg+xml",
    checksum: PLACEHOLDER_CHECKSUM,
    width: null,
    height: null,
    domainMatch: true,
    audienceMatch: true,
    styleMatch: true,
    provenance: { placeholderVersion: "neutral-abstract/1.0" },
  };
}

function buildValidatedManifest(
  intents: readonly AssetIntent[],
  group: AssetManifest["consistencyGroup"],
  resolutions: ReadonlyMap<number, AssetResolution>,
): AssetManifest | null {
  if (intents.some((assetIntent) => !resolutions.has(assetIntent.slotIndex))) return null;
  const unsignedManifest: Omit<AssetManifest, "manifestId"> = {
    schemaVersion: "asset-manifest/1.0",
    consistencyGroup: group,
    slots: intents.map((assetIntent) => ({
      slotIndex: assetIntent.slotIndex,
      role: assetIntent.role,
      required: assetIntent.required,
      identityBearing: assetIntent.identityBearing,
      intent: assetIntent,
      resolution: resolutions.get(assetIntent.slotIndex) as AssetResolution,
    })),
    fallbackPolicy: "fail_closed_on_required_identity_asset",
  };
  const parsed = AssetManifestSchema.safeParse({ ...unsignedManifest, manifestId: sha256(canonicalJson(unsignedManifest)) });
  return parsed.success ? parsed.data : null;
}

function validateProviderPack(
  projectId: string,
  unresolved: readonly AssetIntent[],
  result: Extract<AssetPackResult, { ok: true }>,
): Array<{
  intent: AssetIntent;
  image: Extract<AssetPackResult, { ok: true }>["images"][number];
  validated: ValidatedImage;
  resolution: Extract<AssetResolution, { source: "generated" }>;
}> | null {
  if (result.images.length !== unresolved.length) return null;
  const expected = new Map(unresolved.map((intent) => [intent.slotIndex, intent]));
  const seen = new Set<number>();
  const validated = [];
  try {
    for (const image of result.images) {
      const assetIntent = expected.get(image.slotIndex);
      if (!assetIntent || seen.has(image.slotIndex) || sha256(image.prompt) !== image.promptSha256) return null;
      seen.add(image.slotIndex);
      const validImage = validateGeneratedImage(image.bytes, image.mimeType);
      const checksumHex = validImage.checksum.slice("sha256:".length);
      const expectedFilename = `${checksumHex}.${validImage.ext}`;
      const resolution = AssetResolutionSchema.safeParse({
        source: "generated",
        slotIndex: assetIntent.slotIndex,
        assetId: expectedFilename,
        url: `/api/projects/${projectId}/assets/${expectedFilename}`,
        mimeType: validImage.mimeType,
        checksum: validImage.checksum,
        width: validImage.width,
        height: validImage.height,
        domainMatch: true,
        audienceMatch: true,
        styleMatch: true,
        provenance: {
          provider: result.provider,
          model: result.modelId,
          requestVersion: "asset-pack-request/1.0",
          prompt: image.prompt,
          promptSha256: image.promptSha256,
        },
      });
      if (!resolution.success || resolution.data.source !== "generated") return null;
      validated.push({ intent: assetIntent, image, validated: validImage, resolution: resolution.data });
    }
  } catch {
    return null;
  }
  return validated.sort((left, right) => left.intent.slotIndex - right.intent.slotIndex);
}

async function storeGeneratedPack(
  projectId: string,
  pack: NonNullable<ReturnType<typeof validateProviderPack>>,
  storage: Pick<AssetStorage, "put">,
): Promise<GeneratedAssignment[] | null> {
  const assignments: GeneratedAssignment[] = [];
  try {
    for (const item of pack) {
      const checksumHex = item.validated.checksum.slice("sha256:".length);
      const expectedFilename = `${checksumHex}.${item.validated.ext}`;
      const stored = await storage.put(projectId, item.image.bytes, item.validated.ext, item.validated.mimeType);
      if (stored.filename !== expectedFilename || stored.contentType !== item.validated.mimeType || stored.size !== item.image.bytes.length) return null;
      assignments.push({ intent: item.intent, resolution: item.resolution });
    }
    return assignments;
  } catch {
    return null;
  }
}

export async function resolveDomainAssetManifest(
  input: ResolveDomainAssetManifestInput,
  deps: AssetPipelineDependencies,
): Promise<AssetPipelineResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const parsed = validInputs(input);
  if (!parsed) return { ok: false, code: "invalid_asset", trace: trace({ resultCode: "invalid_manifest" }) };

  let curated: CuratedAssetPackResult;
  try {
    curated = await (deps.resolveCurated ?? resolveCuratedAssetPack)(
      {
        intents: parsed.intents,
        direction: parsed.direction,
        images: await deps.loadCuratedImages(),
        catalogVersion: deps.catalogVersion,
      },
      { fetchImpl: deps.fetchImpl },
    );
  } catch {
    return { ok: false, code: "invalid_asset", trace: trace({ durationMs: Math.max(0, Math.floor(now() - started)), resultCode: "invalid_manifest" }) };
  }

  const assignedIndexes = new Set(curated.assignments.map((assignment) => assignment.slotIndex));
  const unresolved = parsed.intents.filter((assetIntent) => !assignedIndexes.has(assetIntent.slotIndex));
  const group = consistencyGroup(parsed.intents, parsed.direction, curated);
  const commonTrace = {
    consistencyGroupCount: 1 as const,
    curatedCount: curated.assignments.length,
    rejectionCounts: curated.rejections,
  };

  let providerResult: Extract<AssetPackResult, { ok: true }> | null = null;
  let generatedAssignments: GeneratedAssignment[] = [];
  if (input.mode === "hybrid" && unresolved.some((assetIntent) => assetIntent.required)) {
    let generated: AssetPackResult;
    try {
      generated = await deps.provider.createPack({
        schemaVersion: "asset-pack-request/1.0",
        consistencyGroup: group,
        assets: unresolved,
        budget: deps.budget,
      });
    } catch {
      return {
        ok: false,
        code: "provider_error",
        trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, durationMs: Math.max(0, Math.floor(now() - started)), resultCode: "internal_error" }),
      };
    }
    if (!generated.ok) {
      if (!validProviderFailureTelemetry(generated)) {
        return {
          ok: false,
          code: "invalid_asset",
          trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, resultCode: "invalid_provider_output" }),
        };
      }
      const invalidOutput = generated.code === "invalid_image" || generated.code === "invalid_provider_response";
      return {
        ok: false,
        code: invalidOutput ? "invalid_asset" : "provider_error",
        trace: trace({
          ...commonTrace,
          requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length,
          provider: generated.provider,
          modelId: generated.modelId,
          ...(generated.usage ? { usage: generated.usage } : {}),
          durationMs: Math.max(generated.durationMs, Math.max(0, Math.floor(now() - started))),
          resultCode: providerTraceCode(generated),
        }),
      };
    }
    if (!validProviderSuccessTelemetry(generated)) {
      return {
        ok: false,
        code: "invalid_asset",
        trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, resultCode: "invalid_provider_output" }),
      };
    }
    providerResult = generated;
    const validatedPack = validateProviderPack(input.projectId, unresolved, generated);
    if (!validatedPack) {
      return {
        ok: false,
        code: "invalid_asset",
        trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, provider: generated.provider, modelId: generated.modelId, ...(generated.usage ? { usage: generated.usage } : {}), estimatedCostMicromxn: generated.estimatedCostMicromxn, durationMs: generated.durationMs, resultCode: "invalid_provider_output" }),
      };
    }
    const prospectiveResolutions = new Map<number, AssetResolution>(curated.assignments.map((assignment) => [assignment.slotIndex, curatedResolution(assignment)]));
    for (const item of validatedPack) prospectiveResolutions.set(item.intent.slotIndex, item.resolution);
    for (const assetIntent of parsed.intents) {
      if (!prospectiveResolutions.has(assetIntent.slotIndex) && !assetIntent.required && !assetIntent.identityBearing) {
        prospectiveResolutions.set(assetIntent.slotIndex, placeholderResolution(assetIntent));
      }
    }
    if (!buildValidatedManifest(parsed.intents, group, prospectiveResolutions)) {
      return {
        ok: false,
        code: "invalid_asset",
        trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, provider: generated.provider, modelId: generated.modelId, ...(generated.usage ? { usage: generated.usage } : {}), estimatedCostMicromxn: generated.estimatedCostMicromxn, durationMs: generated.durationMs, resultCode: "invalid_manifest" }),
      };
    }
    const stored = await storeGeneratedPack(input.projectId, validatedPack, deps.storage);
    if (!stored) {
      return {
        ok: false,
        code: "storage_error",
        trace: trace({ ...commonTrace, requiredUnresolvedCount: unresolved.filter((assetIntent) => assetIntent.required).length, provider: generated.provider, modelId: generated.modelId, promptSha256: generated.images.map((image) => image.promptSha256), ...(generated.usage ? { usage: generated.usage } : {}), estimatedCostMicromxn: generated.estimatedCostMicromxn, durationMs: generated.durationMs, resultCode: "storage_failure" }),
      };
    }
    generatedAssignments = stored;
  }

  const resolutions = new Map<number, AssetResolution>(curated.assignments.map((assignment) => [assignment.slotIndex, curatedResolution(assignment)]));
  for (const assignment of generatedAssignments) resolutions.set(assignment.intent.slotIndex, assignment.resolution);
  for (const assetIntent of parsed.intents) {
    if (!resolutions.has(assetIntent.slotIndex) && !assetIntent.required && !assetIntent.identityBearing) {
      resolutions.set(assetIntent.slotIndex, placeholderResolution(assetIntent));
    }
  }

  const requiredUnresolved = parsed.intents.filter((assetIntent) => assetIntent.required && !resolutions.has(assetIntent.slotIndex));
  if (requiredUnresolved.length > 0) {
    return {
      ok: false,
      code: "required_asset_unavailable",
      slotIndex: requiredUnresolved[0].slotIndex,
      trace: trace({ ...commonTrace, requiredUnresolvedCount: requiredUnresolved.length, durationMs: Math.max(0, Math.floor(now() - started)), resultCode: "required_asset_unavailable" }),
    };
  }

  const missing = parsed.intents.find((assetIntent) => !resolutions.has(assetIntent.slotIndex));
  if (missing) {
    return {
      ok: false,
      code: "asset_slot_unavailable",
      slotIndex: missing.slotIndex,
      trace: trace({ ...commonTrace, durationMs: Math.max(0, Math.floor(now() - started)), resultCode: "asset_slot_unavailable" }),
    };
  }

  const manifest = buildValidatedManifest(parsed.intents, group, resolutions);
  if (!manifest) {
    return { ok: false, code: "invalid_asset", trace: trace({ ...commonTrace, durationMs: Math.max(0, Math.floor(now() - started)), resultCode: "invalid_manifest" }) };
  }

  const manifestId = manifest.manifestId;
  const promptSha256 = providerResult?.images.map((image) => image.promptSha256) ?? [];
  const placeholderCount = manifest.slots.filter((slot) => slot.resolution.source === "placeholder").length;
  const resolvedTrace = trace({
    ...commonTrace,
    manifestId,
    generatedCount: generatedAssignments.length,
    placeholderCount,
    provider: providerResult?.provider ?? null,
    modelId: providerResult?.modelId ?? null,
    promptSha256,
    ...(providerResult?.usage ? { usage: providerResult.usage } : {}),
    estimatedCostMicromxn: providerResult?.estimatedCostMicromxn ?? 0,
    durationMs: Math.max(providerResult?.durationMs ?? 0, Math.max(0, Math.floor(now() - started))),
    resultCode: "resolved",
  });
  return { ok: true, manifest, trace: resolvedTrace };
}
