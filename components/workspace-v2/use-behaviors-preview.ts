// Paridad editor↔publicado POR CONSTRUCCIÓN: el preview y el bake de
// publicación invocan LA MISMA función. No hay una segunda copia del runtime
// que pueda divergir. Es la deuda que dejó carousel.ts, cuyo comentario ruega
// "KEEP IN SYNC with the inline preview copy in the cinema templates" — una
// súplica escrita en un comentario, que ya se incumplió.
//
// El runtime se inyecta SIEMPRE (nunca condicionalmente: esa vía se abandonó en
// preview-area.tsx:196 por parpadeo y recarga de fuentes). Es el propio runtime
// el que se auto-silencia mientras body[data-openlen-edit-mode] esté puesto —
// ver EDIT_GUARD_JS en lib/behaviors/build.ts.
//
// reg/order son inyectables SOLO para tests (ver use-behaviors-preview.test.ts,
// que prueba paridad byte-a-byte contra bakeBehaviors con un registro falso —
// el real, lib/behaviors/registry.ts, sigue vacío en F1). El único call site
// real (preview-area.tsx) llama con solo `html`, heredando los defaults de
// bakeBehaviors (BEHAVIORS/BEHAVIOR_ORDER).
//
// Task 14b — el carrusel (lib/publish/carousel.ts) es EXACTAMENTE la misma
// deuda que el párrafo de arriba describe, ya vencida una vez: el preview no
// inyectaba su runtime en absoluto (flechas muertas mientras editas, vivas al
// publicar). bakeCarousels ya está desplegado y esta tarea no le toca ni una
// línea, así que en vez de una segunda función aquí, este módulo importa su
// MISMO runtime (CAROUSEL_JS) y su MISMO marcador (MARKER) — nunca una copia —
// y repite únicamente el envoltorio idempotente que bakeCarousels ya usa.
import { bakeBehaviors } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";
import { CAROUSEL_JS, MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

export function injectBehaviorsPreview(
  html: string,
  reg?: Partial<Record<BehaviorName, Behavior>>,
  order?: BehaviorName[],
): string {
  return injectCarouselPreview(bakeBehaviors(html, reg, order));
}

/** Mismo patrón idempotente que bakeCarousels: comprobar marcador, comprobar
 *  disparador, envolver, insertar antes de `</body>`. Nunca reimplementa el
 *  RUNTIME (CAROUSEL_JS es importado) — solo repite el envoltorio, porque
 *  bakeCarousels en sí está congelado (desplegado en producción). */
function injectCarouselPreview(html: string): string {
  if (html.includes(CAROUSEL_MARKER)) return html;
  if (!html.includes("data-ol-scroll=")) return html;
  const script = `<script ${CAROUSEL_MARKER}>${CAROUSEL_JS}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}
