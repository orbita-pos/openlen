export type VisualEngineMode = "off" | "shadow" | "skeleton";

export function visualEngineMode(
  raw = process.env.OPENLEN_VISUAL_ENGINE,
): VisualEngineMode {
  return raw === "shadow" || raw === "skeleton" ? raw : "off";
}

export function shouldRunLegacySafeShadow(
  visualMode: VisualEngineMode,
  safeMode: "off" | "shadow",
): boolean {
  return visualMode === "off" && safeMode === "shadow";
}
