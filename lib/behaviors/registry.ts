// LA fuente única. Una conducta nueva = una entrada aquí; la suite de
// conformidad (conformance.test.ts) demuestra que es correcta, documentada,
// accesible, dentro de presupuesto y que degrada sin romper — o el CI falla.
import { countdown } from "./recipes/countdown";
import { filter } from "./recipes/filter";
import { lightbox } from "./recipes/lightbox";
import { copy } from "./recipes/copy";
import { autoplay } from "./recipes/autoplay";
import type { Behavior, BehaviorName } from "./types";

// Partial mientras la Fase 2 está en curso; el Task 13 (última receta) lo cierra
// y la suite de conformidad exige entonces que estén las 7.
export const BEHAVIORS: Partial<Record<BehaviorName, Behavior>> = {
  countdown,
  filter,
  lightbox,
  copy,
  autoplay,
};

/** Orden determinista de emisión. NUNCA el orden de aparición en el HTML: un
 *  orden variable cambia el hash del script inline y rompe la idempotencia del
 *  sello CSP (crates/html-engine/src/publish/seal.rs hace un self-check y
 *  fallaría con "inline script hash drift"). */
export const BEHAVIOR_ORDER: BehaviorName[] = [
  "countdown", "filter", "lightbox", "copy", "autoplay", "theme", "sticky",
];
