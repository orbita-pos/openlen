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
import { bakeBehaviors } from "@/lib/behaviors/build";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";

export function injectBehaviorsPreview(
  html: string,
  reg?: Partial<Record<BehaviorName, Behavior>>,
  order?: BehaviorName[],
): string {
  return bakeBehaviors(html, reg, order);
}
