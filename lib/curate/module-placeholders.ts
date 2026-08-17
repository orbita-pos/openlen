import type { BridgedModule } from "@/lib/projects/module-intent";

/**
 * El puente AI→módulos, para la ruta de creación que no pasa por Gemini.
 *
 * En la ruta Gemini el modelo aprende de `DESIGN_GUIDANCE` a emitir el hueco
 * del módulo cuando el brief lo pide, y `applyModuleIntent` enciende el flag al
 * verlo. Las páginas compuestas nunca emiten ninguno, así que un negocio que
 * agenda citas salía bonito y muerto por dentro.
 *
 * 🔴 La intención se lee del BRIEF, no de `intent.functional.primaryActions`.
 * Esas acciones se heredan enteras de la ficha de nicho más parecida, y está
 * medido que casi todo brief cae en la de terror, cuya acción es
 * `book_experience`: leerlas de ahí encendería reservas en casi cualquier
 * página. Las palabras del usuario son suyas.
 *
 * `scene3d` queda fuera a propósito: que una página lleve 3D es una decisión
 * estética, no una función del negocio, y no se deduce de un brief.
 */

const EVIDENCE: Record<BridgedModule extends infer T ? Extract<T, "bookings" | "collections"> : never, RegExp> = {
  // Pedir hora. No incluye "cata" ni "evento": son cosas que pasan, no citas
  // que alguien agenda.
  bookings: /\b(agend(a|ar|amos|as)|cita|citas|reserv(a|ar|as|amos|aciones)|turno|turnos|book|booking|bookings|appointment|appointments|schedule)\b/i,
  // Vender cosas. "producto" a secas queda fuera: todo SaaS habla de su
  // producto y ninguno quiere un estante de artículos.
  collections: /\b(cat[áa]logo|catalog|tienda|shop|store|vend(o|e|en|emos|er)|venta|ventas|comprar|e-?commerce)\b/i,
};

/** Los módulos que el brief pide con todas sus letras. */
export function modulesFromBrief(brief: string): Extract<BridgedModule, "bookings" | "collections">[] {
  const text = brief.trim();
  if (!text) return [];
  return (Object.keys(EVIDENCE) as (keyof typeof EVIDENCE)[]).filter((module) => EVIDENCE[module].test(text));
}

const MARKERS = {
  bookings: "data-ol-bookings-section",
  collections: "data-ol-collection-section",
} as const;

/**
 * Deja el hueco que el horneado de publicación busca, con la misma forma que
 * inserta el cajón de Módulos.
 *
 * 🔴 SIN `data-openlen-role`: la puerta de entrega cuenta esos nodos contra el
 * manifiesto de composición, y un hueco que se hiciera pasar por sección haría
 * que refusara la página entera y entregara la baseline en silencio.
 */
export function insertModulePlaceholders(
  html: string,
  modules: readonly Extract<BridgedModule, "bookings" | "collections">[],
): string {
  const missing = modules.filter((module) => !html.includes(MARKERS[module]));
  if (missing.length === 0) return html;
  const bands = missing.map((module) => `<section><div ${MARKERS[module]}></div></section>`).join("");

  const footer = /<footer\b/i.exec(html);
  if (footer) return html.slice(0, footer.index) + bands + html.slice(footer.index);
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  if (bodyClose !== -1) return html.slice(0, bodyClose) + bands + html.slice(bodyClose);
  return html;
}
