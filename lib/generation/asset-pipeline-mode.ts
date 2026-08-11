export type AssetPipelineMode = "off" | "shadow" | "curated" | "hybrid";

export function parseAssetPipelineMode(value: string | undefined): AssetPipelineMode {
  return value === "shadow" || value === "curated" || value === "hybrid" ? value : "off";
}

export function assetPipelineMode(): AssetPipelineMode {
  return parseAssetPipelineMode(process.env.OPENLEN_VISUAL_ENGINE_ASSETS);
}
