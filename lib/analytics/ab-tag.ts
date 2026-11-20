// Canonical A/B experiment tag parser (`<expId>:<variant>`), zero Node deps.
// Shared between analytics snippet, /c/[projectId] beacon, /api/f/[sub] form handler,
// publish pipeline, and Rust edge parity tests.

export const AB_COOKIE_PREFIX = "ol_ab_";
export const AB_OVERRIDE_PARAM = "_ol_ab";

const EXP_ID_RE = /^[a-z0-9][a-z0-9_-]{3,39}$/;
const AB_TAG_RE = /^([a-z0-9][a-z0-9_-]{3,39}):(a|b)$/;

export function isValidExperimentId(id: unknown): id is string {
  return typeof id === "string" && EXP_ID_RE.test(id);
}

export function formatAbTag(expId: string, variant: "a" | "b"): string {
  if (!EXP_ID_RE.test(expId)) {
    throw new Error(`Invalid A/B experiment id: ${expId}`);
  }
  return `${expId}:${variant}`;
}

/** Validate and normalize a raw `<expId>:<a|b>` tag; returns null on anything invalid. */
export function parseAbTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!AB_TAG_RE.test(trimmed)) return null;
  return trimmed;
}

export function splitAbTag(
  raw: unknown,
): { readonly expId: string; readonly variant: "a" | "b" } | null {
  const normalized = parseAbTag(raw);
  if (!normalized) return null;
  const match = AB_TAG_RE.exec(normalized);
  if (!match) return null;
  return { expId: match[1]!, variant: match[2] as "a" | "b" };
}
