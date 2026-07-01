// Client-safe (no zod, no node imports) — whitelists the presentation fields a
// curated model's catalog sceneSpec is allowed to override on the panel draft.
export const MODEL_PRESENTATION_KEYS = ["background", "motion", "look", "camera"] as const;

export function pickModelPresentation(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of MODEL_PRESENTATION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = (raw as Record<string, unknown>)[key];
  }
  return out;
}
