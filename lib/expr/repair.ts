import "server-only";

// lib/expr/repair.ts — cerrar el bucle: lo que se detecta, se arregla.
//
// El sistema ya cazaba con precisión quirúrgica (dice el atributo, la fórmula y
// qué hacer) y luego anotaba y seguía. Este archivo es el estado que faltaba
// entre "detectado" y "el visitante lo sufre".
//
// Sigue el patrón de `lib/document/`: entra HTML, sale HTML y un contador, y
// corre en `beforeMeta` (lib/page-engine/prepare.ts).
//
// ⚰️ Aquí se nombraba a `ensureSingleH1` y `bindColorsToTokens` como «sus
// hermanos». Ya no lo son: eran reparaciones que corregían al modelo por
// detrás, se retiraron de `beforeMeta` el 2026-09-04 y los módulos se borraron
// el 2026-09-05, cuando se vio que lo único que los mantenía vivos eran su
// propia prueba y una puerta de despliegue. Éste se queda por lo que dice el
// párrafo de abajo: no corrige un criterio, EJECUTA lo que el modelo marcó.
//
// SÓLO REPARA LO INEQUÍVOCO. Un paréntesis mal contado o un nombre mal escrito
// necesitan criterio: eso va al reintento dirigido, no aquí. Adivinar qué quiso
// decir el modelo es cómo se rompen las páginas que estaban bien.

import { parse, type HTMLElement } from "node-html-parser";

import {
  FORMULA_ATTRS,
  REGION,
  STATE,
  VALUE,
  compiledAttr,
  unreadValues,
} from "./document";

export interface RepairResult {
  readonly html: string;
  /** Cuántos arreglos se aplicaron. 0 ⇒ `html` es el mismo string que entró. */
  readonly repaired: number;
  /** Qué se hizo, para el informe. Códigos de máquina, no prosa. */
  readonly did: readonly ("wrapped_region" | "dropped_orphan_value")[];
}

const NADA = (html: string): RepairResult => ({ html, repaired: 0, did: [] });

/**
 * Arregla lo que no admite interpretación.
 *
 * NUNCA lanza: un reparador que tumba la ingestión es peor que el defecto que
 * arregla.
 */
export function repairCalcRegions(html: string): RepairResult {
  const marcadores = [REGION, STATE, VALUE, ...FORMULA_ATTRS.map((f) => f.attr)];
  if (!marcadores.some((m) => html.includes(m))) return NADA(html);

  let document: HTMLElement;
  try {
    document = parse(html);
  } catch {
    return NADA(html);
  }

  const did: RepairResult["did"] = [];
  let repaired = 0;

  // ── a) fórmulas fuera de toda región ────────────────────────────────────
  // El caso real: el modelo puso `data-ol-calc` sobre el BOTÓN del sorteo, así
  // que los campos y las salidas quedaron fuera y no se compilaba nada.
  //
  // Se envuelve SÓLO si todas las piezas sueltas cuelgan de un mismo ancestro.
  // Sin ancestro común no se toca: envolver medio documento para rescatar una
  // fórmula rompería más de lo que arregla.
  const sueltas = [VALUE, ...FORMULA_ATTRS.map((f) => f.attr)]
    .flatMap((attr) => document.querySelectorAll(`[${attr}]`))
    .filter((el) => !dentroDeRegion(el));
  if (sueltas.length > 0) {
    const host = ancestroComun(sueltas);
    // La raíz del documento no cuenta: `data-ol-calc` sobre <html> o <body>
    // haría que TODA la página fuera una región, y el ámbito de nombres —que
    // es la mitad del diseño— dejaría de significar nada.
    if (host && !esRaiz(host)) {
      host.setAttribute(REGION, "");
      repaired += 1;
      (did as string[]).push("wrapped_region");
    }
  }

  // ── b) campos que ninguna fórmula lee ───────────────────────────────────
  // Pierden el atributo: el control sigue en la página pero DEJA DE PROMETER.
  // Renombrarlo al nombre que sí se lee sería adivinar cuál de los dos
  // controles quería el modelo (el caso real fue campo + deslizador para el
  // mismo dato), y adivinar mal deja la página peor que el defecto.
  for (const region of document.querySelectorAll(`[${REGION}]`)) {
    const huerfanos = new Set(unreadValues(region));
    if (huerfanos.size === 0) continue;
    for (const el of region.querySelectorAll(`[${VALUE}]`)) {
      const name = el.getAttribute(VALUE)?.trim();
      if (!name || !huerfanos.has(name)) continue;
      el.removeAttribute(VALUE);
      repaired += 1;
      (did as string[]).push("dropped_orphan_value");
    }
  }

  return repaired === 0 ? NADA(html) : { html: document.toString(), repaired, did };
}

/**
 * Apaga una región que sigue rota tras reparar y reintentar.
 *
 * Le quita los marcadores a ESA región, no a la página. Queda estática pero
 * íntegra: el valor de nacimiento ya está escrito dentro del elemento, así que
 * se ve un número real y ningún control que invite a teclear sin responder.
 *
 * Es lo que hace un error boundary con un widget roto — esconderlo, no
 * mostrarlo muerto — y la mitad "avisar al creador" la lleva
 * `collectDegradations` con el código `broken_controls`, que ya existe.
 */
export function disableCalcRegions(html: string, regionIndexes?: readonly number[]): RepairResult {
  if (!html.includes(REGION)) return NADA(html);

  let document: HTMLElement;
  try {
    document = parse(html);
  } catch {
    return NADA(html);
  }

  const regions = document.querySelectorAll(`[${REGION}]`);
  if (regions.length === 0) return NADA(html);

  const attrs = [VALUE, STATE, ...FORMULA_ATTRS.map((f) => f.attr)];
  const todos = [...attrs, ...attrs.map(compiledAttr)];
  let repaired = 0;

  regions.forEach((region, i) => {
    if (regionIndexes && !regionIndexes.includes(i)) return;
    for (const attr of todos) {
      if (region.getAttribute(attr) !== undefined) {
        region.removeAttribute(attr);
        repaired += 1;
      }
      for (const el of region.querySelectorAll(`[${attr}]`)) {
        el.removeAttribute(attr);
        repaired += 1;
      }
    }
    region.removeAttribute(REGION);
    repaired += 1;
  });

  return repaired === 0 ? NADA(html) : { html: document.toString(), repaired, did: [] };
}

/** ¿Vive dentro de una región? (ancestro-o-sí-mismo, como `Element.closest`). */
function dentroDeRegion(el: HTMLElement): boolean {
  for (let cur: HTMLElement | null = el; cur; cur = cur.parentNode) {
    if (cur.getAttribute?.(REGION) !== undefined) return true;
  }
  return false;
}

function esRaiz(el: HTMLElement): boolean {
  const tag = el.tagName?.toUpperCase();
  return tag === "HTML" || tag === "BODY" || !el.parentNode;
}

/** El ancestro más bajo que los contiene a todos, o `null`. */
function ancestroComun(els: readonly HTMLElement[]): HTMLElement | null {
  const cadenas = els.map((el) => {
    const camino: HTMLElement[] = [];
    for (let cur: HTMLElement | null = el; cur; cur = cur.parentNode) camino.unshift(cur);
    return camino;
  });
  const primera = cadenas[0];
  if (!primera) return null;
  let comun: HTMLElement | null = null;
  for (let i = 0; i < primera.length; i += 1) {
    const cand = primera[i]!;
    if (cadenas.every((c) => c[i] === cand)) comun = cand;
    else break;
  }
  return comun;
}
