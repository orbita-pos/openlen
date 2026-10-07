// LOS PASOS DE `use_page` (H9) — la forma de la entrada y su validación.
//
// Aparte del motor (`usar-pagina.ts`) a propósito: `lib/agent/tools.ts` valida
// la entrada ANTES de abrir nada, y el motor arrastra Chromium y el origen de
// medida, un grafo que las pruebas de `tools` no quieren detrás (la misma razón
// por la que `observarPagina` se cablea en la ruta).

export type PasoDeUso =
  | { readonly click: string; readonly within?: string }
  | { readonly type: string; readonly into: string }
  | { readonly choose: string; readonly within?: string }
  | { readonly reload: true }
  | { readonly read: string };

/** Pasos por visita. Una visita de Claude Test tiene ~30 acciones de techo; aquí
 *  cada paso espera a que la página se quede quieta, y el turno tiene su reloj. */
export const MAX_PASOS = 12;
const MAX_TEXTO = 200;
// En inglés desde el 2026-10-06, como las herramientas de DeepSeek: eran
// `pulsa`, `escribe` + `en`, `elige`, `recarga`, `lee` y `dentro_de`
// (lo guardado se traduce al leer, `tool-renames.ts`).
const VERBOS = ["click", "type", "choose", "reload", "read"] as const;
const CLAVES = new Set<string>([...VERBOS, "into", "within"]);

/**
 * La entrada, comprobada ANTES de abrir nada — el orden del ejecutor de Claude
 * Code: forma, esquema y validación, y sólo entonces se ejecuta. Una llamada que
 * no valida no corre ni un paso.
 */
export function validarPasos(
  bruto: unknown,
): { readonly ok: true; readonly pasos: PasoDeUso[] } | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, error: '"steps" has to be a list with at least one step, e.g. [{"click":"Add"},{"read":"Total"}].' };
  }
  if (bruto.length > MAX_PASOS) {
    return { ok: false, error: `A visit carries at most ${MAX_PASOS} steps and this one brings ${bruto.length}. Split it into two visits.` };
  }
  const pasos: PasoDeUso[] = [];
  for (const [i, p] of bruto.entries()) {
    const n = i + 1;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: `Step ${n} isn't an object: each step is {"click": "…"}, {"type": "…", "into": "…"}, {"choose": "…"}, {"reload": true} or {"read": "…"}.` };
    }
    const o = p as Record<string, unknown>;
    const extra = Object.keys(o).find((k) => !CLAVES.has(k));
    if (extra) return { ok: false, error: `Step ${n} brings an unexpected parameter \`${extra}\`. The ones there are: click, type + into, choose, reload, read, and within with click or choose.` };
    const verbos = VERBOS.filter((v) => o[v] !== undefined);
    if (verbos.length !== 1) {
      return {
        ok: false,
        error:
          verbos.length === 0
            ? `Step ${n} doesn't say what to do: it carries one of click, type, choose, reload or read.`
            : `Step ${n} carries ${verbos.map((v) => `\`${v}\``).join(" and ")}: each step does ONE thing. Split it into several steps.`,
      };
    }
    const verbo = verbos[0]!;
    const texto = (k: string): string | null => {
      const v = o[k];
      return typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXTO ? v.trim() : null;
    };
    if (o.into !== undefined && verbo !== "type") return { ok: false, error: `Step ${n}: \`into\` only goes with \`type\` (the field where it is typed).` };
    if (o.within !== undefined && verbo !== "click" && verbo !== "choose") {
      return { ok: false, error: `Step ${n}: \`within\` only goes with \`click\` or \`choose\`, to choose between identical controls.` };
    }
    const dentro = o.within === undefined ? undefined : texto("within");
    if (o.within !== undefined && !dentro) return { ok: false, error: `Step ${n}: \`within\` has to be a text of up to ${MAX_TEXTO} characters.` };
    if (verbo === "reload") {
      if (o.reload !== true) return { ok: false, error: `Step ${n}: \`reload\` goes as {"reload": true}.` };
      pasos.push({ reload: true });
      continue;
    }
    const valor = verbo === "type" ? (typeof o.type === "string" && o.type.length <= MAX_TEXTO ? o.type : null) : texto(verbo);
    if (valor === null) return { ok: false, error: `Step ${n}: \`${verbo}\` has to be a text of up to ${MAX_TEXTO} characters.` };
    if (verbo === "type") {
      const into = texto("into");
      if (!into) return { ok: false, error: `Step ${n}: \`type\` needs \`into\`, the field's label, placeholder or name.` };
      pasos.push({ type: valor, into });
    } else if (verbo === "click") pasos.push(dentro ? { click: valor, within: dentro } : { click: valor });
    else if (verbo === "choose") pasos.push(dentro ? { choose: valor, within: dentro } : { choose: valor });
    else pasos.push({ read: valor });
  }
  return { ok: true, pasos };
}
