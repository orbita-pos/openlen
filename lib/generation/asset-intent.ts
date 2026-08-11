import { AssetIntentSchema, AssetResolutionSchema, type AssetIntent, type AssetResolution } from "@/lib/generation/asset-contracts";
import { IntentAnalysisSchema, type IntentAnalysis } from "@/lib/generation/contracts";
import { CreativeDirectionSchema, SkeletonInventorySchema, type CreativeDirection, type SkeletonAdaptationPlan, type SkeletonInventory } from "@/lib/generation/creative-contracts";

export interface BuildAssetIntentsInput {
  intent: IntentAnalysis;
  direction: CreativeDirection;
  inventory: SkeletonInventory;
  plan: Pick<SkeletonAdaptationPlan, "assets">;
  originalProvenance?: ReadonlyMap<number, AssetResolution>;
}

export class AssetIntentError extends Error {
  readonly code = "asset_slot_unavailable";

  constructor(readonly reasonCode: "asset_slot_unavailable", readonly slotIndex: number) {
    super(`${reasonCode}:${slotIndex}`);
    this.name = "AssetIntentError";
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function querySubjects(value: string | null): string[] {
  if (!value) return [];
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((part) => /^[a-z0-9]+$/.test(part));
}

function hasRequiredSignal(value: string | null, signals: readonly string[]): boolean {
  if (!value) return false;
  const text = ` ${value.toLowerCase().replace(/[_-]+/g, " ")} `;
  return signals.some((signal) => text.includes(` ${signal.replace(/_/g, " ")} `));
}

function verifiedOriginal(slotIndex: number, originals: ReadonlyMap<number, AssetResolution> | undefined): boolean {
  if (!originals) return false;
  const parsed = AssetResolutionSchema.safeParse(originals.get(slotIndex));
  return parsed.success && parsed.data.slotIndex === slotIndex && parsed.data.source !== "placeholder" && parsed.data.domainMatch && parsed.data.audienceMatch && parsed.data.styleMatch;
}

export function buildAssetIntents(input: BuildAssetIntentsInput): AssetIntent[] {
  const intent = IntentAnalysisSchema.parse(input.intent);
  const direction = CreativeDirectionSchema.parse(input.direction);
  const inventory = SkeletonInventorySchema.parse(input.inventory);
  // The public boundary is intentionally the already-validated assets subset;
  // accepting the full plan here would let unrelated model-controlled fields in.
  const plan = input.plan;
  const requiredSignals = unique([...intent.requiredVisualSignals, ...direction.requiredVisualSignals]);
  const forbiddenSignals = unique([...intent.forbiddenVisualSignals, ...direction.forbiddenVisualSignals, ...direction.imagery.avoid]);
  const audiences = unique([intent.audience.primary, ...intent.audience.secondary, ...(intent.audience.ageRange ? [intent.audience.ageRange] : [])]);

  return plan.assets.map((instruction) => {
    const slot = inventory.assetSlots.find((candidate) => candidate.slotIndex === instruction.slotIndex);
    if (!slot || !slot.replaceable) throw new AssetIntentError("asset_slot_unavailable", instruction.slotIndex);
    if (instruction.action === "keep" && verifiedOriginal(instruction.slotIndex, input.originalProvenance)) return null;
    const identityBearing = slot.role === "hero" || hasRequiredSignal(instruction.query, requiredSignals) || hasRequiredSignal(instruction.alt, requiredSignals);
    const aspectRatio = slot.role === "hero" ? "16:9" : slot.role === "section" ? "4:3" : "1:1";
    return AssetIntentSchema.parse({
      slotIndex: slot.slotIndex,
      role: slot.role,
      required: instruction.required,
      identityBearing,
      mediaType: instruction.mediaType,
      subjects: unique([...direction.imagery.subjects, ...querySubjects(instruction.query)]).slice(0, 12),
      domains: unique(intent.domains).slice(0, 12),
      audiences: audiences.slice(0, 12),
      visualArchetype: direction.visualArchetype,
      emotionalTone: unique(direction.emotionalTone).slice(0, 12),
      aspectRatio,
      focalPoint: "center",
      alt: instruction.alt ?? slot.currentAlt,
      requiredSignals: requiredSignals.slice(0, 12),
      forbiddenSignals: forbiddenSignals.slice(0, 12),
    });
  }).filter((asset): asset is AssetIntent => asset !== null).sort((left, right) => left.slotIndex - right.slotIndex);
}
