// LOS PASOS DE `usar_pagina` (H9) — la forma de la entrada y su validación.
//
// Aparte del motor (`usar-pagina.ts`) a propósito: `lib/agent/tools.ts` valida
// la entrada ANTES de abrir nada, y el motor arrastra Chromium y el origen de
// medida, un grafo que las pruebas de `tools` no quieren detrás (la misma razón
// por la que `observarPagina` se cablea en la ruta).

export type PasoDeUso =
  | { readonly pulsa: string; readonly dentro_de?: string }
  | { readonly escribe: string; readonly en: string }
  | { readonly elige: string; readonly dentro_de?: string }
  | { readonly recarga: true }
  | { readonly lee: string };

/** Pasos por visita. Una visita de Claude Test tiene ~30 acciones de techo; aquí
 *  cada paso espera a que la página se quede quieta, y el turno tiene su reloj. */
export const MAX_PASOS = 12;
const MAX_TEXTO = 200;
const VERBOS = ["pulsa", "escribe", "elige", "recarga", "lee"] as const;
const CLAVES = new Set<string>([...VERBOS, "en", "dentro_de"]);

/**
 * La entrada, comprobada ANTES de abrir nada — el orden del ejecutor de Claude
 * Code: forma, esquema y validación, y sólo entonces se ejecuta. Una llamada que
 * no valida no corre ni un paso.
 */
export function validarPasos(
  bruto: unknown,
): { readonly ok: true; readonly pasos: PasoDeUso[] } | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, error: '"pasos" has to be a list with at least one step, e.g. [{"pulsa":"Add"},{"lee":"Total"}].' };
  }
  if (bruto.length > MAX_PASOS) {
    return { ok: false, error: `A visit carries at most ${MAX_PASOS} steps and this one brings ${bruto.length}. Split it into two visits.` };
  }
  const pasos: PasoDeUso[] = [];
  for (const [i, p] of bruto.entries()) {
    const n = i + 1;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: `Step ${n} isn't an object: each step is {"pulsa": "…"}, {"escribe": "…", "en": "…"}, {"elige": "…"}, {"recarga": true} or {"lee": "…"}.` };
    }
    const o = p as Record<string, unknown>;
    const extra = Object.keys(o).find((k) => !CLAVES.has(k));
    if (extra) return { ok: false, error: `Step ${n} brings an unexpected parameter \`${extra}\`. The ones there are: pulsa, escribe + en, elige, recarga, lee, and dentro_de with pulsa or elige.` };
    const verbos = VERBOS.filter((v) => o[v] !== undefined);
    if (verbos.length !== 1) {
      return {
        ok: false,
        error:
          verbos.length === 0
            ? `Step ${n} doesn't say what to do: it carries one of pulsa, escribe, elige, recarga or lee.`
            : `Step ${n} carries ${verbos.map((v) => `\`${v}\``).join(" and ")}: each step does ONE thing. Split it into several steps.`,
      };
    }
    const verbo = verbos[0]!;
    const texto = (k: string): string | null => {
      const v = o[k];
      return typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXTO ? v.trim() : null;
    };
    if (o.en !== undefined && verbo !== "escribe") return { ok: false, error: `Step ${n}: \`en\` only goes with \`escribe\` (the field where it is typed).` };
    if (o.dentro_de !== undefined && verbo !== "pulsa" && verbo !== "elige") {
      return { ok: false, error: `Step ${n}: \`dentro_de\` only goes with \`pulsa\` or \`elige\`, to choose between identical controls.` };
    }
    const dentro = o.dentro_de === undefined ? undefined : texto("dentro_de");
    if (o.dentro_de !== undefined && !dentro) return { ok: false, error: `Step ${n}: \`dentro_de\` has to be a text of up to ${MAX_TEXTO} characters.` };
    if (verbo === "recarga") {
      if (o.recarga !== true) return { ok: false, error: `Step ${n}: \`recarga\` goes as {"recarga": true}.` };
      pasos.push({ recarga: true });
      continue;
    }
    const valor = verbo === "escribe" ? (typeof o.escribe === "string" && o.escribe.length <= MAX_TEXTO ? o.escribe : null) : texto(verbo);
    if (valor === null) return { ok: false, error: `Step ${n}: \`${verbo}\` has to be a text of up to ${MAX_TEXTO} characters.` };
    if (verbo === "escribe") {
      const en = texto("en");
      if (!en) return { ok: false, error: `Step ${n}: \`escribe\` needs \`en\`, the field's label, placeholder or name.` };
      pasos.push({ escribe: valor, en });
    } else if (verbo === "pulsa") pasos.push(dentro ? { pulsa: valor, dentro_de: dentro } : { pulsa: valor });
    else if (verbo === "elige") pasos.push(dentro ? { elige: valor, dentro_de: dentro } : { elige: valor });
    else pasos.push({ lee: valor });
  }
  return { ok: true, pasos };
}
