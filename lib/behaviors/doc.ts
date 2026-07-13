import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";

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
  solo (contador en vivo, filtro, lightbox, copiar al portapapeles, autoplay,
  tema claro/oscuro, barra pegajosa al bajar). El runtime lo HORNEA OpenLen a
  partir del marcador declarativo (el atributo \`data-ol-*\`) que emitas — tú
  SOLO escribes el markup de cada receta, nunca un \`<script>\`, nunca un
  atributo \`on*\`: eso se borra igual que cualquier otro. Usa el nombre y el
  marcador EXACTOS de la lista de abajo; no existen más conductas que estas.

${recipes}`;
}
