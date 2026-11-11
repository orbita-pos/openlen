// HER LOOK, FROM HER ROW (spec local 2026-11-10-figuras-del-asistente, §5.5): the whole figure is saved in
// `assistants.look`. A row from before the figures has none: it wears the default look in the color it already had.
//
// Pure.
import { checkLook, DEFAULT_LOOK, type FigureLook } from "@/lib/figure/look";

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function lookOfRow(row: { look?: unknown; color: string }): FigureLook {
  const saved = checkLook(row.look);
  if (saved.ok) return saved.value;
  return typeof row.color === "string" && COLOR.test(row.color) ? { ...DEFAULT_LOOK, color: row.color.toLowerCase() } : DEFAULT_LOOK;
}
