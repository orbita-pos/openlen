import type { AssetIntent, AssetManifest } from "@/lib/generation/asset-contracts";

export interface AssetGenerationBudget {
  version: string;
  maxCostMicromxn: number;
  estimatedImageCostMicromxn: number;
}

const RATE_CARD_VERSION_ENV = "OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION";
const MAX_COST_ENV = "OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN";
const ESTIMATED_IMAGE_COST_ENV = "OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN";

function exactPositiveInteger(value: string, field: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`invalid_asset_generation_budget:${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid_asset_generation_budget:${field}`);
  return parsed;
}

export function parseAssetGenerationBudget(env: NodeJS.ProcessEnv): AssetGenerationBudget | null {
  const version = env[RATE_CARD_VERSION_ENV];
  const maxCost = env[MAX_COST_ENV];
  const estimatedImageCost = env[ESTIMATED_IMAGE_COST_ENV];

  if (version !== undefined) exactPositiveInteger(version, RATE_CARD_VERSION_ENV);
  if (maxCost !== undefined) exactPositiveInteger(maxCost, MAX_COST_ENV);
  if (estimatedImageCost !== undefined) exactPositiveInteger(estimatedImageCost, ESTIMATED_IMAGE_COST_ENV);
  if (version === undefined || maxCost === undefined || estimatedImageCost === undefined) return null;

  return {
    version,
    maxCostMicromxn: exactPositiveInteger(maxCost, MAX_COST_ENV),
    estimatedImageCostMicromxn: exactPositiveInteger(estimatedImageCost, ESTIMATED_IMAGE_COST_ENV),
  };
}

export interface AssetPackProvider {
  capabilities(): { generate: boolean; editFromReference: boolean; maxAssets: number };
  createPack(request: AssetPackRequest): Promise<AssetPackResult>;
}

export interface AssetPackRequest {
  schemaVersion: "asset-pack-request/1.0";
  consistencyGroup: AssetManifest["consistencyGroup"];
  assets: readonly AssetIntent[];
  budget: AssetGenerationBudget;
}

export interface AssetPackUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
}

export type AssetPackResult =
  | {
      ok: true;
      provider: string;
      modelId: string;
      images: Array<{
        slotIndex: number;
        bytes: Buffer;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        prompt: string;
        promptSha256: `sha256:${string}`;
      }>;
      usage?: AssetPackUsage;
      estimatedCostMicromxn: number;
      durationMs: number;
    }
  | {
      ok: false;
      code:
        | "provider_unavailable"
        | "provider_timeout"
        | "provider_error"
        | "provider_blocked"
        | "invalid_provider_response"
        | "invalid_image"
        | "budget_exhausted";
      provider: string;
      modelId: string;
      usage?: AssetPackUsage;
      durationMs: number;
    };
