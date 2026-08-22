import "server-only";

// lib/style-match/reference.ts — de una URL a una DIRECCIÓN visual.
//
// La tubería completa, en un módulo puro para que la ruta sea sólo auth +
// límite de tasa + JSON, y para que esto se pueda probar sin levantar Next.
//
//   URL → validar (SSRF) → Chrome → medir estilos → Qwen mira → dirección
//
// POR QUÉ NO PASA POR `orchestrate`. El orquestador se queda con el PRIMER
// nivel que funcione, y el nivel 1 (fetch crudo) casi siempre funciona — pero
// no produce ni captura ni estilos calculados, que es justo lo que esta feature
// necesita. Medido en la Etapa A. Aquí se pide el navegador directamente.

import { describeReferenceCharacter } from "./character";
import { directionFromTokens, type StyleDirection } from "./direction";
import { extractTokens } from "./extract/merge-tokens";
import { fetchPuppeteer } from "./scrape/fetch-puppeteer";
import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";

export type ReferenceFailure =
  /** La URL apunta a algo que no debemos alcanzar. NUNCA se detalla al cliente:
   *  decirle "resuelve a 10.0.0.5" le confirma qué hay en la red interna. */
  | { readonly code: "blocked" }
  /** No se pudo traer: caída, timeout, challenge anti-bot, 404. */
  | { readonly code: "unreachable" }
  /** Se trajo pero sin render utilizable — sin estilos no hay paleta. */
  | { readonly code: "not_rendered" };

export interface ReferenceDeps {
  /** Ausente ⇒ sin la capa de carácter. La dirección MEDIDA sale igual: la
   *  mitad cara es opcional por diseño. */
  readonly client?: FireworksJsonClient;
  readonly requestId: string;
}

export async function referenceFromUrl(
  url: string,
  deps: ReferenceDeps,
): Promise<{ ok: true; direction: StyleDirection } | { ok: false; error: ReferenceFailure }> {
  const scraped = await fetchPuppeteer({ url });
  if (!scraped.ok) {
    // `fetchPuppeteer` ya llamó a `validateUrl`, y revalida cada redirección.
    const kind = scraped.error.kind;
    if (kind === "ssrf-blocked" || kind === "invalid-url") return { ok: false, error: { code: "blocked" } };
    return { ok: false, error: { code: "unreachable" } };
  }

  let direction: StyleDirection;
  try {
    direction = directionFromTokens(extractTokens(scraped.value));
  } catch {
    // `extractTokens` LANZA sin estilos calculados. Sin paleta no hay
    // dirección que dar, y dar una inventada sería peor que no dar ninguna.
    return { ok: false, error: { code: "not_rendered" } };
  }

  const shot = scraped.value.screenshot;
  if (!deps.client || !shot) return { ok: true, direction };

  const character = await describeReferenceCharacter(
    { requestId: deps.requestId, screenshotBase64: shot.toString("base64") },
    { client: deps.client },
  );
  return { ok: true, direction: character ? { ...direction, character } : direction };
}
