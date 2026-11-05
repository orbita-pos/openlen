/**
 * EL CANVAS, POR PÍXELES (spec local 2026-11-05-ojos-que-ven-el-movimiento, §8.5). `use_page` decidía
 * «cambió / no cambió» con el texto de la página, y un canvas no tiene texto: un juego que se movía
 * salía como «nothing changed». Aquí, cuánto cambió entre dos capturas pequeñas del canvas y si el
 * paso se distingue de lo que el canvas cambia SOLO — lo mismo que ya hace el texto con `cambiantes`.
 *
 * Hechos, no veredictos: la línea dice cifras y Len decide.
 */
import type { PngCrudo } from "@/lib/ai/png-crudo";

/** Lo que un canal puede moverse sin contar (compresión, suavizado del render por software). */
export const CHANNEL_TOLERANCE = 16;
/** Por debajo de esta fracción de píxeles, el canvas no cambió. */
export const UNCHANGED_BELOW = 0.002;
/** Un paso se distingue de lo que el canvas cambia solo si cambia más de esto veces lo de solo. */
export const BEYOND_SELF_FACTOR = 2;

/** Fracción (0–1) de píxeles en los que algún canal de color difiere más de `CHANNEL_TOLERANCE`; tamaños distintos = 1. */
export function pixelChange(a: PngCrudo, b: PngCrudo): number {
  if (a.ancho !== b.ancho || a.alto !== b.alto) return 1;
  const total = a.ancho * a.alto;
  if (total === 0) return 0;
  let distintos = 0;
  for (let p = 0; p < total; p++) {
    const ia = p * a.canales;
    const ib = p * b.canales;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(a.datos[ia + c]! - b.datos[ib + c]!) > CHANNEL_TOLERANCE) {
        distintos++;
        break;
      }
    }
  }
  return distintos / total;
}

export type CanvasVerdict = "changed" | "only_by_itself" | "unchanged";

export function classifyCanvasChange(c: { readonly selfChange: number; readonly stepChange: number }): CanvasVerdict {
  if (c.stepChange < UNCHANGED_BELOW) return "unchanged";
  if (c.stepChange <= c.selfChange * BEYOND_SELF_FACTOR) return "only_by_itself";
  return "changed";
}

const pct = (x: number) => String(Math.round(x * 1000) / 10);

export function canvasLine(v: CanvasVerdict, c: { readonly selfChange: number; readonly stepChange: number }): string {
  if (v === "unchanged") return "the canvas didn't change.";
  if (v === "only_by_itself") return `the canvas keeps changing by itself (about ${pct(c.selfChange)} %) and this step's effect can't be told apart from that.`;
  const solo = c.selfChange >= UNCHANGED_BELOW ? ` (by itself it changes about ${pct(c.selfChange)} % in the same time)` : "";
  return `the canvas changed: ${pct(c.stepChange)} % of its pixels${solo}.`;
}
