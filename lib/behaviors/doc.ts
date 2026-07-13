import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";

// La nómina en prosa (nombre + número) que leen los otros TRES sitios que
// mencionan las conductas por fuera del catálogo generado — design-guidance.ts,
// agent/catalog.ts y agent/tools.ts (el aviso `sanitizeAviso`) — se DERIVA de
// aquí, nunca se escribe a mano en esos archivos. Es la imagen especular del
// bug fundacional: la lista y el número vivían escritos SUELTOS en cuatro
// sitios en prosa (dos de ellos con "siete" hardcodeado), así que una 8ª
// receta nacería con runtime + validador + entrada generada aquí, pero
// AUSENTE de esas cuatro frases. `BEHAVIOR_ORDER.join`/`.length` sobre el
// mismo array que ya gobierna el orden de emisión (build.ts) y el catálogo
// cerrado (registry.ts) — nunca una segunda lista.
export const BEHAVIOR_NAMES = BEHAVIOR_ORDER.join(", ");
export const BEHAVIOR_COUNT = BEHAVIOR_ORDER.length;

// La documentación que lee la IA se GENERA de aquí — nunca se escribe aparte.
// Es la razón de ser de este archivo: el bug que originó el proyecto entero
// (DESIGN_GUIDANCE prometía un <script> que el sanitizer llevaba MESES
// borrando) se vuelve estructuralmente imposible, porque la IA y el motor
// leen el MISMO objeto (BEHAVIORS/BEHAVIOR_ORDER) — nunca dos copias que
// puedan divergir.
//
// Recorre BEHAVIOR_ORDER (el orden real de emisión), NUNCA una lista escrita
// a mano: una receta nueva entra sola en la guía sin tocar este archivo, y
// una receta que falte del registro es imposible de expresar (BEHAVIORS es
// un Record completo desde el Task 13 — TypeScript rechaza el hueco).
//
// PURO a propósito (cero node:/DOM/process.env), como registry.ts y
// recipes/*.ts: lo importa design-guidance.ts, que a su vez importa medio
// repo — rutas de servidor Y el preview del editor, que es componente
// cliente.
export function buildBehaviorsDoc(): string {
  const recipes = BEHAVIOR_ORDER.map((name) => BEHAVIORS[name])
    // `deprecated` sigue viva para páginas publicadas que ya la usan (el
    // motor aún la hornea si el marcador aparece), pero deja de OFRECERSE
    // para HTML nuevo: no tiene sentido que la IA la elija a propósito.
    .filter((b) => b.status !== "deprecated")
    .map(
      (b) => `  – ${b.name} (\`${b.marker}\`)
    Cuándo usarla: ${b.doc.when}
    Cuándo NO usarla: ${b.doc.whenNot}
    Ejemplo:
${b.doc.example}`,
    )
    .join("\n\n");

  return `• CONDUCTAS — interactividad real que el CSS no puede lograr por sí
  solo (${BEHAVIOR_COUNT}: ${BEHAVIOR_NAMES}). El runtime lo HORNEA OpenLen a
  partir del marcador declarativo (el atributo \`data-ol-*\`) que emitas — tú
  SOLO escribes el markup de cada receta, nunca un \`<script>\`, nunca un
  atributo \`on*\`: eso se borra igual que cualquier otro. Usa el nombre y el
  marcador EXACTOS de la lista de abajo; no existen más conductas que estas.

${recipes}`;
}
