export type AiCreationMode = "enabled" | "disabled";

export function aiCreationMode(
  raw = process.env.OPENLEN_AI_CREATION,
): AiCreationMode {
  return raw === "enabled" ? "enabled" : "disabled";
}
