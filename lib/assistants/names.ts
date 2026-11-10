// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio): what its creator accepts. Its name becomes
// its address, /<locale>/assistant/<slug>, so a name needs a slug. The shapes are placeholders until the figures'
// design pass (phase 6), and the creator must not depend on how many there are.
//
// Pure.
import { routing } from "@/i18n/routing";

export const ASSISTANT_NAME_MAX = 40;
export const ASSISTANT_SHAPES = ["blob", "ring", "drop", "square"] as const;
export type AssistantShape = (typeof ASSISTANT_SHAPES)[number];
export const ASSISTANT_TONES = ["friendly", "formal", "playful"] as const;
export type AssistantTone = (typeof ASSISTANT_TONES)[number];

export interface AssistantInput {
  name: string;
  shape: AssistantShape;
  color: string;
  tone: AssistantTone;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** One of the site's languages (`i18n/routing.ts`), as the page that sent it: the morning summary's (phase 4D). Anything
 *  else is the site's default. */
export function siteLocaleOf(raw: unknown): string {
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? raw : routing.defaultLocale;
}

/** «Lucía» → `lucia`, «Señor Pan» → `senor-pan`, «さくら» → `さくら`, «Ольга Ли» → `ольга-ли`: Latin accents go, the
 *  letters and digits of every script stay (the address is private, so they travel percent-encoded); `""` when
 *  nothing of it is a letter or a digit. NFC after stripping, so Hangul isn't left in decomposed jamo. */
export function assistantSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** The `[name]` of /<locale>/assistant/<name>, decoded once if it arrived percent-encoded. A slug has no `%`, so
 *  decoding an already decoded one changes nothing; a malformed one stays as it came (and finds no assistant). */
export function slugFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Her name as it is kept (trimmed, one space between words), or `null` when it can't be one: empty, too long, or with
 *  nothing an address can be made from. Creating and renaming her share it. */
export function cleanAssistantName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return name && name.length <= ASSISTANT_NAME_MAX && assistantSlug(name) ? name : null;
}

export function checkAssistantInput(
  raw: Record<string, unknown>,
): { ok: true; value: AssistantInput } | { ok: false; field: "name" | "shape" | "color" | "tone" } {
  const name = cleanAssistantName(raw.name);
  if (!name) return { ok: false, field: "name" };
  if (!includes(ASSISTANT_SHAPES, raw.shape)) return { ok: false, field: "shape" };
  if (typeof raw.color !== "string" || !COLOR.test(raw.color)) return { ok: false, field: "color" };
  if (!includes(ASSISTANT_TONES, raw.tone)) return { ok: false, field: "tone" };
  return { ok: true, value: { name, shape: raw.shape, color: raw.color, tone: raw.tone } };
}
