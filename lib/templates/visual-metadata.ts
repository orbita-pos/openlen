import { z } from "zod";
import { TaxonomySlugSchema } from "@/lib/generation/contracts";

const SlugList = z.array(TaxonomySlugSchema).max(40);

export const TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION = "template-visual-metadata/1.0" as const;

export const TemplateVisualMetadataSchema = z.object({
  schemaVersion: z.literal(TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION),
  domains: SlugList.min(1),
  audiences: SlugList.min(1),
  ageRanges: SlugList,
  emotionalRegisters: SlugList,
  visualArchetypes: SlugList,
  visualSignals: SlugList,
  layoutTraits: SlugList,
  requiredAssetTypes: SlugList,
  negativeTags: SlugList,
  supportedSiteTypes: SlugList.min(1),
  supportedSectionRoles: SlugList.min(1),
  themeability: z.enum(["low", "medium", "high"]),
  identityStrength: z.enum(["low", "medium", "high"]),
  reviewStatus: z.enum(["unreviewed", "reviewed", "rejected"]),
});

export type TemplateVisualMetadata = z.infer<typeof TemplateVisualMetadataSchema>;

export function parseTemplateVisualMetadata(value: unknown): TemplateVisualMetadata | null {
  const parsed = TemplateVisualMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
