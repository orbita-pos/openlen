import { createHash } from "node:crypto";
import { z } from "zod";

import { TaxonomySlugSchema } from "@/lib/generation/contracts";

const SafeAssetTextSchema = z.string().min(1).max(240).refine(
  (value) => !/<\/?[a-z]|\b(?:https?|data|javascript|file):|[{}]/i.test(value),
  "must not contain HTML, URLs, scripts, or free-form CSS",
);
const SafePromptSchema = z.string().min(1).max(1200).refine(
  (value) => !/<\/?[a-z]|\b(?:https?|data|javascript|file):|[{}]/i.test(value),
  "must not contain HTML, URLs, scripts, or free-form CSS",
);
const TaxonomyListSchema = (minimum = 0) => z.array(TaxonomySlugSchema).min(minimum).max(12).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be unique" });
});

export type AssetMediaType = "photo" | "illustration" | "texture";
export type AssetSlotRole = "hero" | "section" | "card";
export type AssetResolutionSource = "template" | "curated" | "generated" | "abstract" | "placeholder";

export const AssetIntentSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  role: z.enum(["hero", "section", "card"]),
  required: z.boolean(),
  identityBearing: z.boolean(),
  mediaType: z.enum(["photo", "illustration", "texture"]),
  subjects: TaxonomyListSchema(),
  domains: TaxonomyListSchema(1),
  audiences: TaxonomyListSchema(1),
  visualArchetype: TaxonomySlugSchema,
  emotionalTone: TaxonomyListSchema(),
  aspectRatio: z.enum(["1:1", "4:3", "3:2", "16:9", "9:16", "21:9"]),
  focalPoint: z.enum(["center", "top", "bottom", "left", "right"]),
  alt: SafeAssetTextSchema,
  requiredSignals: TaxonomyListSchema(),
  forbiddenSignals: TaxonomyListSchema(),
}).strict();

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CommonResolutionSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  assetId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  url: z.string().min(1).max(512),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  checksum: HashSchema,
  width: z.number().int().min(1).max(4096).nullable(),
  height: z.number().int().min(1).max(4096).nullable(),
  domainMatch: z.literal(true),
  audienceMatch: z.literal(true),
  styleMatch: z.literal(true),
});

function isCatalogUrl(url: string): boolean {
  return /^https:\/\/images\.openlen\.com\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(url);
}

function isPlaceholderUrl(url: string): boolean {
  return /^\/openlen-assets\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(url);
}

function isGeneratedUrl(url: string): boolean {
  const pathPattern = /^\/api\/projects\/[a-z0-9][a-z0-9_-]{0,127}\/assets\/[a-f0-9]{64}\.(?:png|jpg|jpeg|webp)$/;
  const configuredBaseUrl = process.env.OPENLEN_APP_BASE_URL;
  if (pathPattern.test(url)) return true;
  if (!configuredBaseUrl) return false;
  try {
    const base = new URL(configuredBaseUrl);
    const candidate = new URL(url);
    return candidate.origin === base.origin && pathPattern.test(candidate.pathname) && !candidate.search && !candidate.hash;
  } catch {
    return false;
  }
}

const CatalogResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("curated"),
  provenance: z.object({ catalogVersion: z.string().min(1).max(96), license: z.literal("openlen_catalog") }).strict(),
}).strict();
const AbstractResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("abstract"),
  provenance: z.object({ catalogVersion: z.string().min(1).max(96), license: z.literal("openlen_catalog") }).strict(),
}).strict();
const GeneratedResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("generated"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provenance: z.object({ provider: z.string().min(1).max(64), model: z.string().min(1).max(96), requestVersion: z.literal("asset-pack-request/1.0"), prompt: SafePromptSchema, promptSha256: HashSchema }).strict(),
}).strict();
const TemplateResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("template"),
  provenance: z.object({ templateId: z.string().min(1).max(180), metadataVersion: z.string().min(1).max(96) }).strict(),
}).strict();
const PlaceholderResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("placeholder"),
  mimeType: z.literal("image/svg+xml"),
  provenance: z.object({ placeholderVersion: z.literal("neutral-abstract/1.0") }).strict(),
}).strict();

export const AssetResolutionSchema = z.discriminatedUnion("source", [
  CatalogResolutionSchema,
  AbstractResolutionSchema,
  GeneratedResolutionSchema,
  TemplateResolutionSchema,
  PlaceholderResolutionSchema,
]).superRefine((value, ctx) => {
  const validUrl = (value.source === "curated" || value.source === "abstract" || value.source === "template")
    ? isCatalogUrl(value.url)
    : value.source === "generated"
      ? isGeneratedUrl(value.url)
      : isPlaceholderUrl(value.url);
  if (!validUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "URL does not satisfy the source policy" });
});

export const AssetManifestSchema = z.object({
  schemaVersion: z.literal("asset-manifest/1.0"),
  manifestId: HashSchema,
  consistencyGroup: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/), mediaType: z.enum(["photo", "illustration", "texture"]), artDirection: TaxonomySlugSchema, paletteHints: TaxonomyListSchema(), styleLock: TaxonomySlugSchema }).strict(),
  slots: z.array(z.object({ slotIndex: z.number().int().min(0).max(255), role: z.enum(["hero", "section", "card"]), required: z.boolean(), identityBearing: z.boolean(), intent: AssetIntentSchema, resolution: AssetResolutionSchema }).strict()).max(12),
  fallbackPolicy: z.literal("fail_closed_on_required_identity_asset"),
}).strict().superRefine((value, ctx) => {
  const slotIndexes = new Set<number>();
  let generatedCount = 0;
  value.slots.forEach((slot, index) => {
    if (slotIndexes.has(slot.slotIndex)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", index, "slotIndex"], message: "slot indexes must be unique" });
    slotIndexes.add(slot.slotIndex);
    if (slot.slotIndex !== slot.intent.slotIndex || slot.slotIndex !== slot.resolution.slotIndex) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", index], message: "slot, intent, and resolution indexes must match" });
    }
    if (slot.role !== slot.intent.role || slot.required !== slot.intent.required || slot.identityBearing !== slot.intent.identityBearing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", index], message: "slot fields must match its intent" });
    }
    if (slot.intent.mediaType !== value.consistencyGroup.mediaType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", index, "intent", "mediaType"], message: "all slots must use the primary consistency group media type" });
    }
    if (slot.resolution.source === "generated") generatedCount += 1;
    if (slot.resolution.source === "placeholder" && (slot.required || slot.identityBearing)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots", index, "resolution"], message: "placeholders are only allowed for optional non-identity slots" });
    }
  });
  if (generatedCount > 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slots"], message: "at most three generated resolutions are allowed" });
});

export const AssetResolutionTraceSchema = z.object({
  schemaVersion: z.literal("asset-resolution-trace/1.0"),
  manifestId: HashSchema.nullable(),
  consistencyGroupCount: z.number().int().min(0).max(1),
  curatedCount: z.number().int().min(0).max(12),
  generatedCount: z.number().int().min(0).max(3),
  abstractCount: z.number().int().min(0).max(12),
  placeholderCount: z.number().int().min(0).max(12),
  requiredUnresolvedCount: z.number().int().min(0).max(12),
  rejectionCounts: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().int().nonnegative()),
  provider: z.string().max(64).nullable(),
  modelId: z.string().max(96).nullable(),
  promptSha256: z.array(HashSchema).max(3),
  estimatedCostMicromxn: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  resultCode: z.string().regex(/^[a-z0-9_]+$/).max(64),
}).strict();

export type AssetResolution = z.infer<typeof AssetResolutionSchema>;
export type AssetIntent = z.infer<typeof AssetIntentSchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
export type AssetResolutionTrace = z.infer<typeof AssetResolutionTraceSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateAssetManifestHash(manifest: unknown): boolean {
  const parsed = AssetManifestSchema.safeParse(manifest);
  if (!parsed.success) return false;
  const { manifestId, ...unsignedManifest } = parsed.data;
  const computed = `sha256:${createHash("sha256").update(canonicalJson(unsignedManifest)).digest("hex")}`;
  return computed === manifestId;
}
