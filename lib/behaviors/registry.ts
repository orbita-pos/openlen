// LA fuente única. Una conducta nueva = una entrada aquí; la suite de
// conformidad (conformance.test.ts) demuestra que es correcta, documentada,
// accesible, dentro de presupuesto y que degrada sin romper — o el CI falla.
import { countdown } from "./recipes/countdown";
import { filter } from "./recipes/filter";
import { lightbox } from "./recipes/lightbox";
import { copy } from "./recipes/copy";
import { autoplay } from "./recipes/autoplay";
import { theme } from "./recipes/theme";
import { sticky } from "./recipes/sticky";
import { tabs } from "./recipes/tabs";
import { calc } from "./recipes/calc";
import type { Behavior, BehaviorName } from "./types";

// Record completo desde el Task 13 (última receta, séptima y cierre del
// catálogo): las 7 conductas de BEHAVIOR_ORDER existen. La suite de
// conformidad (conformance.test.ts) exige igualdad estricta entre las claves
// de aquí y BEHAVIOR_ORDER — registrar una conducta sin ponerla en el orden
// (o al revés) es CI rojo a partir de ahora, y `Record` (ya no `Partial`)
// hace que TypeScript mismo rechace un catálogo incompleto en tiempo de
// compilación, antes de llegar siquiera al test.
export const BEHAVIORS: Record<BehaviorName, Behavior> = {
  countdown,
  filter,
  lightbox,
  copy,
  autoplay,
  theme,
  sticky,
  tabs,
  calc,
};

/** Orden determinista de emisión. NUNCA el orden de aparición en el HTML: un
 *  orden variable cambia el hash del script inline y rompe la idempotencia del
 *  sello CSP (crates/html-engine/src/publish/seal.rs hace un self-check y
 *  fallaría con "inline script hash drift"). */
export const BEHAVIOR_ORDER: BehaviorName[] = [
  "countdown", "filter", "lightbox", "copy", "autoplay", "theme", "sticky", "tabs", "calc",
];
