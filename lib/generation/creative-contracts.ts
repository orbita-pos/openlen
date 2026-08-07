import { z } from "zod";
import { TaxonomySlugSchema } from "@/lib/generation/contracts";
import { CREATIVE_FONT_MOODS, CREATIVE_RADIUS_SCALES, CREATIVE_SPACING_SCALES, CREATIVE_TOKEN_ALLOWLIST, HOOK_PROPERTY_POLICY } from "@/lib/generation/creative-registry";

const MAX_CREATIVE_LIST_LENGTH = 12;
const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const HookIdSchema = z.string().regex(/^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/).max(96);
const allowedDeclarationProperties = new Set<string>(Object.values(HOOK_PROPERTY_POLICY).flat());
const DeclarationPropertySchema = z.string().refine((property) => allowedDeclarationProperties.has(property), "must be an approved hook property");
const containsProhibitedEmbeddedContent = (value: string) => /<\/?[a-z][^>]*>|\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:javascript|vbscript|data|file|mailto):/i.test(value);
const safeTextSchema = (maxLength: number) => z.string().min(1).max(maxLength).refine(
  (value) => !containsProhibitedEmbeddedContent(value) && !/[{}]|\b(?:background(?:-color|-image)?|border(?:-color|-radius)?|box-shadow|color|content|display|fill|font-family|gap|padding|position|stroke(?:-width|-linecap|-linejoin)?|text-align)\s*:/i.test(value),
  "must not contain HTML, scripts, URLs, or free-form CSS",
);
const SafeTextSchema = safeTextSchema(180);
const TaxonomyListSchema = z.array(TaxonomySlugSchema).max(MAX_CREATIVE_LIST_LENGTH).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain duplicates" });
});

const FontMoodSchema = z.enum(Object.keys(CREATIVE_FONT_MOODS) as [keyof typeof CREATIVE_FONT_MOODS, ...(keyof typeof CREATIVE_FONT_MOODS)[]]);
const RadiusScaleSchema = z.union(CREATIVE_RADIUS_SCALES.map((value) => z.literal(value)) as [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<1.75>]);
const SpacingScaleSchema = z.union(CREATIVE_SPACING_SCALES.map((value) => z.literal(value)) as [z.ZodLiteral<0.85>, z.ZodLiteral<1>, z.ZodLiteral<1.15>]);

export const CreativeDirectionSchema = z.object({
  schemaVersion: z.literal("creative-direction/1.0"),
  mode: z.enum(["light", "dark", "cream"]),
  visualArchetype: TaxonomySlugSchema,
  emotionalTone: TaxonomyListSchema,
  palette: z.object({ background: ColorSchema, surface: ColorSchema, surfaceAlt: ColorSchema, foreground: ColorSchema, foregroundMuted: ColorSchema, accent: ColorSchema, accentInk: ColorSchema, border: ColorSchema }).strict(),
  typography: z.object({ display: FontMoodSchema, body: FontMoodSchema, mono: z.literal("ui_monospace").nullable(), scale: z.enum(["compact", "balanced", "expressive"]) }).strict(),
  geometry: z.object({ radius: z.enum(["square", "soft", "round", "extra_round"]), radiusScale: RadiusScaleSchema, spacingScale: SpacingScaleSchema, density: z.enum(["low", "low_medium", "medium", "high"]) }).strict(),
  imagery: z.object({ strategy: z.enum(["photo_first", "illustration_first", "mixed", "texture_first"]), artDirection: TaxonomySlugSchema, subjects: TaxonomyListSchema, avoid: TaxonomyListSchema }).strict(),
  iconography: z.object({ style: z.enum(["rounded_outline", "rounded_filled", "geometric_outline", "minimal_outline"]), strokeWeight: z.enum(["light", "medium", "bold"]), cornerStyle: z.enum(["round", "soft", "square"]) }).strict(),
  componentTreatment: z.object({ cards: TaxonomySlugSchema, buttons: TaxonomySlugSchema, navigation: TaxonomySlugSchema, sections: TaxonomySlugSchema }).strict(),
  requiredVisualSignals: TaxonomyListSchema,
  forbiddenVisualSignals: TaxonomyListSchema,
}).strict();

export const SkeletonInventorySchema = z.object({
  schemaVersion: z.literal("skeleton-inventory/1.0"),
  templateId: SafeTextSchema,
  availableTokens: z.array(z.string().refine((token) => CREATIVE_TOKEN_ALLOWLIST.has(token), "must be an approved creative token")).max(MAX_CREATIVE_LIST_LENGTH).superRefine((tokens, ctx) => {
    if (new Set(tokens).size !== tokens.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "available tokens must be unique" });
  }),
  styleHooks: z.array(z.object({ id: HookIdSchema, selector: z.string().min(1).max(240), allowedProperties: z.array(DeclarationPropertySchema).max(MAX_CREATIVE_LIST_LENGTH).superRefine((properties, ctx) => {
    if (new Set(properties).size !== properties.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "allowed properties must be unique" });
  }) }).strict()).max(MAX_CREATIVE_LIST_LENGTH),
  assetSlots: z.array(z.object({ slotIndex: z.number().int().min(0).max(255), kind: z.literal("image"), role: z.enum(["hero", "section", "card"]), currentAlt: SafeTextSchema, replaceable: z.boolean() }).strict()).max(MAX_CREATIVE_LIST_LENGTH),
  structuralFingerprint: z.string().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.styleHooks.map((hook) => hook.id)).size !== value.styleHooks.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["styleHooks"], message: "style hook IDs must be unique" });
  if (new Set(value.assetSlots.map((asset) => asset.slotIndex)).size !== value.assetSlots.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetSlots"], message: "asset slot indices must be unique" });
});

const CssOverrideSchema = z.object({
  hookId: HookIdSchema,
  declarations: z.record(DeclarationPropertySchema, z.string().min(1).max(180).refine((value) => !containsProhibitedEmbeddedContent(value) && !/[{};]/.test(value), "must not contain HTML, URLs, scripts, or free-form CSS")),
}).strict();

const AssetInstructionSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  action: z.enum(["keep", "replace"]),
  mediaType: z.enum(["photo", "illustration", "texture"]),
  query: safeTextSchema(180).nullable(),
  alt: safeTextSchema(240).nullable(),
  required: z.boolean(),
}).strict();

export const SkeletonAdaptationPlanSchema = z.object({
  schemaVersion: z.literal("skeleton-adaptation-plan/1.0"),
  tokens: z.record(z.string().refine((token) => CREATIVE_TOKEN_ALLOWLIST.has(token), "must be an approved creative token"), z.string().min(1).max(180).refine((value) => !containsProhibitedEmbeddedContent(value) && !/[{};]/.test(value), "must not contain HTML, URLs, scripts, or free-form CSS")),
  cssOverride: z.array(CssOverrideSchema).max(MAX_CREATIVE_LIST_LENGTH),
  assets: z.array(AssetInstructionSchema).max(MAX_CREATIVE_LIST_LENGTH),
}).strict().superRefine((value, ctx) => {
  const hookIds = value.cssOverride.map((override) => override.hookId);
  if (new Set(hookIds).size !== hookIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cssOverride"], message: "CSS override hook IDs must be unique" });
  const assetIndices = value.assets.map((asset) => asset.slotIndex);
  if (new Set(assetIndices).size !== assetIndices.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: "asset slot indices must be unique" });
  value.assets.forEach((asset, index) => {
    const mustHaveDetails = asset.action === "replace";
    if (mustHaveDetails && (asset.query === null || asset.alt === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets", index], message: "replace requires query and alt" });
    if (!mustHaveDetails && (asset.query !== null || asset.alt !== null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets", index], message: "keep requires null query and alt" });
  });
});

export const SkeletonAdaptationFailureCodeSchema = z.enum(["cannot_remove_forbidden_signal", "cannot_add_required_signal", "asset_slot_unavailable", "hook_property_not_allowed"]);
export type SkeletonAdaptationFailureCode = z.infer<typeof SkeletonAdaptationFailureCodeSchema>;

export const SkeletonCreativeResponseSchema = z.union([
  z.object({ schemaVersion: z.literal("skeleton-creative-response/1.0"), status: z.literal("ready"), direction: CreativeDirectionSchema, plan: SkeletonAdaptationPlanSchema }).strict(),
  z.object({ schemaVersion: z.literal("skeleton-creative-response/1.0"), status: z.literal("incompatible"), reasonCode: SkeletonAdaptationFailureCodeSchema }).strict(),
]);

export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>;
export type SkeletonInventory = z.infer<typeof SkeletonInventorySchema>;
export type SkeletonAdaptationPlan = z.infer<typeof SkeletonAdaptationPlanSchema>;
export type SkeletonCreativeResponse = z.infer<typeof SkeletonCreativeResponseSchema>;
