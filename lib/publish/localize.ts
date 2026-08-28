// ─────────────────────────────────────────────────────────────────────────────
// Speak Every Language — publish-time page translation.
//
// Given the FINAL baked HTML (post image/font bake, post forms/analytics —
// publishToDir calls this right before sealing), produce one translated
// document per target locale:
//
//   1. The Rust pass extracts every translatable string in document order
//      (text nodes + alt/title/placeholder/aria-label/OG metas/submit
//      values — markup, classes, animations and custom CSS stay
//      byte-identical, the fidelity lesson from the Canva rollback).
//   2. A per-string cache (projectTranslations, keyed by sha1-16 of the
//      source text) is diffed: only NEW or CHANGED strings go to Gemini —
//      one Flash call per locale, structured output, marginal republish
//      cost ≈ zero. The cache row is rewritten with exactly the current
//      page's strings, so stale entries prune themselves.
//   3. The Rust pass reinjects the translated strings by document order
//      and stamps <html lang>. A slot-count mismatch skips the locale —
//      a half-translated page never ships.
//
// Per-locale soft-fail: a Gemini error/timeout drops that locale from this
// publish (the root page always publishes). Pricing note: translations are
// currently NOT debited as credits — the per-string cache bounds the spend
// to edited strings; revisit if abuse shows up.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { extractTranslatables, reinjectTranslatables } from "@/lib/html-engine";
import { GeminiProvider } from "@/lib/ai-gateway";
import { fireworksStreamProvider, type StreamProviderLike } from "@/lib/ai/fireworks-as-stream-provider";
import {
  isPublishLocale,
  LOCALE_ENGLISH_NAMES,
} from "@/lib/publish/publish-locales";

const TRANSLATE_MODEL =
  process.env.OPENLEN_TRANSLATE_MODEL?.trim() || "gemini-3.5-flash";
const TRANSLATE_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 32_768;
// A landing page is typically 50-200 strings; anything past this is a
// pathological document we'd rather not feed to the model in one publish.
const MAX_STRINGS = 1_000;
const MAX_TARGETS = 9;

const TRANSLATIONS_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    translations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["translations"],
  propertyOrdering: ["translations"],
};

export type TranslateFn = (
  texts: string[],
  targetLocale: string,
  sourceLang: string,
) => Promise<string[] | null>;

export interface LocaleDoc {
  locale: string;
  html: string;
}

export interface LocalizeParams {
  projectId: string;
  /** Final baked HTML — extraction and reinjection both run on this. */
  html: string;
  /** Target locale codes (validated against PUBLISH_LOCALES). */
  targets: string[];
  /** The page's own language — excluded from targets, named in the prompt. */
  sourceLang: string;
  /** Test seam — defaults to the Gemini translator. */
  translateFn?: TranslateFn;
}

function hashText(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);
}

function languageName(code: string): string {
  return LOCALE_ENGLISH_NAMES[code] ?? code;
}

/** EL prompt del traductor. Exportado para que una prueba pueda MIRARLO: su
 *  contrato de SALIDA vive aquí y en ningún otro sitio desde que el
 *  `responseSchema` dejó de viajar a Fireworks. Cuando ese contrato se perdió
 *  no lo cazó nadie, porque este fichero no tenía una sola prueba y la función
 *  no había traducido nunca una página en producción. */
export function buildTranslatePrompt(
  texts: string[],
  targetLocale: string,
  sourceLang: string,
): string {
  return [
    `You are translating the visible copy of a published landing page from ${languageName(sourceLang)} to ${languageName(targetLocale)}.`,
    "Rules:",
    `- Return EXACTLY ${texts.length} translations, in the same order as the input array.`,
    "- Translate naturally and concisely, marketing-quality copy. Keep each translation roughly the same length as the source so the page layout doesn't break.",
    "- NEVER translate brand names, product names, people's names, email addresses, URLs, phone numbers, hashtags or code — keep them verbatim inside the translated string.",
    "- Strings that need no translation (already in the target language, or untranslatable) come back unchanged.",
    `- Use punctuation and typographic conventions appropriate for ${languageName(targetLocale)}.`,
    "",
    // LA FORMA DE SALIDA VA EN EL PROMPT, y tiene que ir.
    //
    // La daba `responseSchema` (TRANSLATIONS_SCHEMA) cuando esto corría por
    // Gemini. Al pasar a Fireworks el esquema se descarta a propósito —lo
    // rechaza, está medido— y NADIE lo sustituyó: quedó `jsonObject: true` y un
    // prompt que pide «EXACTLY N translations» sin decir nunca dentro de qué.
    //
    // Lo que devolvía el modelo, medido el 2026-08-28 contra la API real:
    //     {"type": "object"}
    // Un trozo de esquema. En modo JSON sin forma declarada no sabe qué
    // producir. Los tres idiomas caían en «bad translation shape», y la
    // función NO ha traducido nunca una página en producción.
    `Return a JSON object with exactly one key, "translations": an array of ${texts.length} strings, in the same order as the input. No other keys, no commentary.`,
    `Example shape for 2 inputs: {"translations":["first translation","second translation"]}`,
    "",
    "Input strings (JSON array):",
    JSON.stringify(texts),
  ].join("\n");
}

async function geminiTranslate(
  texts: string[],
  targetLocale: string,
  sourceLang: string,
): Promise<string[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildTranslatePrompt(texts, targetLocale, sourceLang);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    // Traducir es texto, no píxeles: lo hace DeepSeek por el transporte de
    // Fireworks. `OPENLEN_TRANSLATE=gemini` vuelve atrás.
    //
    // Sin esquema estricto a propósito: Fireworks rechaza esquemas válidos
    // (medido), y el parseo de abajo ya tolera vallas de markdown. Lo que NO se
    // relaja es la comprobación de longitud: una traducción con menos entradas
    // que el original se descarta entera, aquí y antes.
    const usaGemini = process.env.OPENLEN_TRANSLATE?.trim().toLowerCase() === "gemini";
    const provider: StreamProviderLike = usaGemini
      ? (new GeminiProvider(apiKey) as unknown as StreamProviderLike)
      : fireworksStreamProvider({
          requestId: `localize.${targetLocale}`,
          operation: "copy",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          jsonObject: true,
        });
    let raw = "";
    for await (const ev of provider.stream(
      {
        model: TRANSLATE_MODEL,
        messages: [{ role: "user", content: prompt }],
        responseMimeType: "application/json",
        responseSchema: TRANSLATIONS_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      },
      { signal: ctrl.signal },
    )) {
      if (ev.type === "text_delta") {
        raw += ev.text;
      } else if (ev.type === "done" && ev.stopReason.kind === "error") {
        // eslint-disable-next-line no-console
        console.warn(`[localize] gemini error (${targetLocale}):`, ev.stopReason.error);
        return null;
      }
    }
    const parsed = JSON.parse(raw) as { translations?: unknown };
    const out = parsed?.translations;
    if (
      !Array.isArray(out) ||
      out.length !== texts.length ||
      out.some((t) => typeof t !== "string")
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[localize] bad translation shape (${targetLocale}): got ${Array.isArray(out) ? out.length : typeof out}, want ${texts.length}`,
      );
      return null;
    }
    return out as string[];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[localize] translate failed (${targetLocale}):`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadCache(
  projectId: string,
  locale: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ entries: schema.projectTranslations.entries })
    .from(schema.projectTranslations)
    .where(
      and(
        eq(schema.projectTranslations.projectId, projectId),
        eq(schema.projectTranslations.locale, locale),
      ),
    )
    .limit(1);
  return rows[0]?.entries ?? {};
}

async function saveCache(
  projectId: string,
  locale: string,
  entries: Record<string, string>,
): Promise<void> {
  await db
    .insert(schema.projectTranslations)
    .values({ projectId, locale, entries, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        schema.projectTranslations.projectId,
        schema.projectTranslations.locale,
      ],
      set: { entries, updatedAt: new Date() },
    });
}

/**
 * Translate the final page into each target locale. Always resolves; a
 * locale that can't be fully translated is simply absent from the result.
 */
export async function localizeForPublish(
  params: LocalizeParams,
): Promise<LocaleDoc[]> {
  const { projectId, html, sourceLang } = params;
  const translate = params.translateFn ?? geminiTranslate;

  const targets = [...new Set(params.targets)]
    .filter((code) => isPublishLocale(code) && code !== sourceLang)
    .slice(0, MAX_TARGETS);
  if (targets.length === 0) return [];

  const texts = extractTranslatables(html);
  if (texts.length === 0 || texts.length > MAX_STRINGS) return [];
  const hashes = texts.map(hashText);

  const docs: LocaleDoc[] = [];
  for (const locale of targets) {
    try {
      const cached = await loadCache(projectId, locale);

      // Unique missing source strings, preserving first-seen order.
      const missing: string[] = [];
      const seen = new Set<string>();
      texts.forEach((text, i) => {
        const h = hashes[i];
        if (cached[h] === undefined && !seen.has(h)) {
          seen.add(h);
          missing.push(text);
        }
      });

      const merged: Record<string, string> = {};
      // Keep only entries the current page still uses (self-pruning).
      hashes.forEach((h) => {
        if (cached[h] !== undefined) merged[h] = cached[h];
      });

      if (missing.length > 0) {
        const translated = await translate(missing, locale, sourceLang);
        if (!translated) continue; // soft-fail: skip this locale
        missing.forEach((text, i) => {
          merged[hashText(text)] = translated[i];
        });
      }

      const ordered = texts.map((text, i) => merged[hashes[i]] ?? text);
      const localized = reinjectTranslatables(html, ordered, locale);
      if (localized === null) {
        // eslint-disable-next-line no-console
        console.warn(`[localize] slot count drifted for ${locale}; skipping`);
        continue;
      }

      await saveCache(projectId, locale, merged);
      docs.push({ locale, html: localized });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[localize] locale ${locale} failed; skipping`, err);
    }
  }
  return docs;
}
