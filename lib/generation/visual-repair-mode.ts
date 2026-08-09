export type VisualRepairMode = "off" | "shadow" | "on";

export function parseVisualRepairMode(raw: string | undefined): VisualRepairMode {
  return raw === "shadow" || raw === "on" ? raw : "off";
}

export function visualRepairMode(): VisualRepairMode {
  return parseVisualRepairMode(process.env.OPENLEN_VISUAL_ENGINE_REPAIR);
}
