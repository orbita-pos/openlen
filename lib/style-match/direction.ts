import "server-only";

// lib/style-match/direction.ts — de una web ajena a una DIRECCIÓN visual.
//
// Lo que sale de aquí es lo ÚNICO que viaja al brief. Ni un byte del HTML
// ajeno: eso es la línea entre inspirarse y calcar, y es lo que hace que el
// documento resultante sea del usuario y no una copia del de otro.
//
// DOS CAPAS, y en este orden a propósito:
//   1. lo MEDIDO — paleta, tipografía, radios y densidad salen de los estilos
//      calculados del render (`extract/`). Exacto, gratis, reproducible.
//   2. lo VISTO — Qwen mira la captura y añade lo que ningún CSS dice: el
//      carácter, el ritmo, la sensación.
//
// La capa 2 es opcional por diseño: si la llamada de visión falla, la
// dirección sigue siendo útil. Una referencia a medias es mejor que ninguna, y
// la mitad cara no puede tumbar la mitad gratis.

import type { StyleDirection } from "./direction-types";
import type { ExtractedTokens } from "./extract/types";

/** El techo del bloque que se antepone al brief.
 *
 *  La sección CONDUCTAS ya es el 45% del prompt de crear, y eso lo pagan TODAS
 *  las generaciones. Esto sólo aparece cuando hay referencia — pero un techo
 *  declarado es lo que impide que "sólo cuando hay referencia" se convierta en
 *  "y además enorme". Mismo mecanismo que `docBudgetChars` en las conductas. */
export const DIRECTION_BUDGET_CHARS = 900;

/** La forma vive en `direction-types` (sin `server-only`) porque el compositor
 *  de /new la necesita para enseñar la referencia y poder quitarla. */
export type { StyleDirection } from "./direction-types";

/** La mitad MEDIDA. Sin modelo, sin red, sin coste. */
export function directionFromTokens(tokens: ExtractedTokens): StyleDirection {
  const palette: { role: string; hex: string }[] = [];
  if (tokens.color.primary) palette.push({ role: "principal", hex: tokens.color.primary.hex });
  for (const a of tokens.color.accents.slice(0, 2)) {
    palette.push({ role: "acento", hex: a.hex });
  }
  // Los neutros llevan el peso visual de una página entera —fondos, textos,
  // bordes— así que dos dicen más del carácter que cinco acentos.
  for (const n of tokens.color.neutrals.slice(0, 2)) {
    palette.push({ role: `neutro ${n.step}`, hex: n.entry.hex });
  }

  return {
    hostname: tokens.source.hostname,
    palette,
    polarity: tokens.color.polarity,
    fontFamily: tokens.typography.family.display ?? tokens.typography.family.primary,
    radius: tokens.radius.personality,
  };
}

/**
 * El bloque que se antepone al brief.
 *
 * Escrito como INSTRUCCIÓN de dirección, no como descripción de otra web: al
 * modelo hay que decirle qué hacer, no contarle qué vio alguien. Y se le dice
 * explícitamente que el contenido es del usuario — sin eso, un modelo que lee
 * "inspírate en stripe.com" tiende a escribir copy de Stripe.
 */
export function directionToBriefBlock(d: StyleDirection): string {
  const colores = d.palette.map((p) => `${p.hex} (${p.role})`).join(", ");
  const partes = [
    "<direccion-visual>",
    `El usuario tomó como referencia el ESTILO de una página que le gusta. Escribe una página PROPIA con su contenido y este carácter — nunca copies texto, estructura ni marcado de la referencia.`,
    `Paleta medida del render: ${colores}.`,
    `Fondo ${d.polarity === "dark" ? "oscuro" : "claro"}. Tipografía tipo ${d.fontFamily}. Esquinas ${radiusEs(d.radius)}.`,
  ];
  if (d.character) partes.push(`Carácter: ${d.character}`);
  partes.push("</direccion-visual>");
  const bloque = partes.join("\n");
  // Se recorta por el final: la paleta y la polaridad van primero a propósito,
  // porque son lo medido. Lo que se pierde al truncar es el carácter, que es lo
  // opinable.
  if (bloque.length <= DIRECTION_BUDGET_CHARS) return bloque;
  // El cierre se CUENTA, no se estima: un `- 20` a ojo dejaba el bloque en 901
  // caracteres con un techo de 900, y un presupuesto que se pasa por uno es un
  // presupuesto que no se está respetando.
  const cierre = "…\n</direccion-visual>";
  return bloque.slice(0, DIRECTION_BUDGET_CHARS - cierre.length) + cierre;
}

function radiusEs(r: StyleDirection["radius"]): string {
  switch (r) {
    case "sharp": return "rectas";
    case "soft": return "apenas redondeadas";
    case "rounded": return "redondeadas";
    case "pill": return "muy redondeadas, tipo píldora";
  }
}
