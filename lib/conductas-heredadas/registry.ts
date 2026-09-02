// CONDUCTAS HEREDADAS — ya no se ofrecen. NO añadas una nueva.
//
// Este catálogo de recetas declarativas (`data-ol-*`) existía porque el
// JavaScript del modelo estaba PROHIBIDO: si el usuario pedía un filtro o una
// cuenta atrás, la única salida era cablear una de estas nueve. El 2026-08-23
// se abrió el JavaScript libre y el catálogo se retiró de los tres prompts
// (medido el 28/08: cero menciones en crear, Chat y Agente). Hoy «haz que este
// botón filtre» lo resuelve el modelo escribiendo el script, y puede hacer EL
// que la página pide en vez de uno de nueve.
//
// ENTONCES, ¿POR QUÉ SIGUE VIVO? Por las páginas que YA los tienen:
//   · `validate.ts` corre en la puerta de publicación y en el motor de página,
//     para que un marcador mal cableado no llegue al subdominio de nadie.
//   · `build.ts` lo usa la vista previa del taller, para que esas páginas
//     sigan siendo interactivas mientras se editan.
// Es compatibilidad hacia atrás, no una feature.
//
// La cabecera anterior decía «LA fuente única. Una conducta nueva = una entrada
// aquí». Eso invitaba a ampliar un catálogo retirado, y un nombre o un
// comentario que miente arrastra a todo el que pasa — que es justo el miedo que
// hizo renombrar este directorio el 2026-08-28. Si hace falta algo interactivo
// nuevo, lo escribe el modelo.
//
// `conformance.test.ts` sigue demostrando que las nueve existentes son
// correctas, accesibles y degradan sin romper — o el CI falla.
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

/** Orden determinista de emisión. NUNCA el orden de aparición en el HTML:
 *  hornear dos veces la misma página tiene que dar los mismos bytes.
 *
 *  🔴 CORREGIDO el 2026-09-01. Decía que un orden variable «rompe la
 *  idempotencia del sello CSP (seal.rs hace un self-check y fallaría con
 *  "inline script hash drift")». Hoy eso no puede pasar por partida doble: la
 *  CSP se retiró el 2026-08-26, y la auto-comprobación que este comentario
 *  nombraba se fue CON ella — seal.rs lo dice donde estaba, «LA
 *  AUTO-COMPROBACIÓN SE VA CON LA POLÍTICA … sin hashes que emitir no hay
 *  deriva posible». Esa cadena de error ya no existe en ningún sitio del repo:
 *  este comentario era el único que la nombraba.
 *
 *  El motivo vivo es el de `present()` en build.ts —bytes estables, para que un
 *  re-horneado no ensucie el diff—, y está escrito ahí. */
export const BEHAVIOR_ORDER: BehaviorName[] = [
  "countdown", "filter", "lightbox", "copy", "autoplay", "theme", "sticky", "tabs", "calc",
];
