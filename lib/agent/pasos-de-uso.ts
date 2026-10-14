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
  | { readonly read: string }
  // Los ojos como Claude Code (14/10): la captura vuelve al modelo como imagen
  // («screen» = lo que hay en pantalla; otro texto = el bloque que lo contiene),
  // y `eval` corre JavaScript en la página, como el `javascript_tool` de su
  // navegador o el `eval` de `chromium-cli`.
  | { readonly screenshot: string }
  | { readonly eval: string };

/** Pasos por visita. Una visita de Claude Test tiene ~30 acciones de techo; aquí
 *  cada paso espera a que la página se quede quieta, y el turno tiene su reloj. */
export const MAX_PASOS = 12;
const MAX_TEXTO = 200;
/** Capturas por visita: cada una son ~1.000 tokens que viajan en las vueltas siguientes. */
export const MAX_SCREENSHOTS_PER_VISIT = 3;
/** El código de un `eval`: lo que cabe en una inspección, no un programa. */
export const MAX_EVAL_CHARS = 4_000;
// En inglés desde el 2026-10-06, como las herramientas de DeepSeek: eran
// `pulsa`, `escribe` + `en`, `elige`, `recarga`, `lee` y `dentro_de`
// (lo guardado se traduce al leer, `tool-renames.ts`).
const VERBOS = ["click", "type", "choose", "reload", "read", "screenshot", "eval"] as const;
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
  const screenshots = bruto.filter((p) => p && typeof p === "object" && (p as Record<string, unknown>).screenshot !== undefined).length;
  if (screenshots > MAX_SCREENSHOTS_PER_VISIT) {
    return { ok: false, error: `A visit takes at most ${MAX_SCREENSHOTS_PER_VISIT} screenshots and this one asks for ${screenshots}. Keep the ones that show what you need to see.` };
  }
  const pasos: PasoDeUso[] = [];
  for (const [i, p] of bruto.entries()) {
    const n = i + 1;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return {
        ok: false,
        error: `Step ${n} isn't an object: each step is {"click": "…"}, {"type": "…", "into": "…"}, {"choose": "…"}, {"reload": true}, {"read": "…"}, {"screenshot": "screen"} or {"eval": "…"}.`,
      };
    }
    const o = p as Record<string, unknown>;
    const extra = Object.keys(o).find((k) => !CLAVES.has(k));
    if (extra) return { ok: false, error: `Step ${n} brings an unexpected parameter \`${extra}\`. The ones there are: click, type + into, choose, reload, read, screenshot, eval, and within with click or choose.` };
    const verbos = VERBOS.filter((v) => o[v] !== undefined);
    if (verbos.length !== 1) {
      return {
        ok: false,
        error:
          verbos.length === 0
            ? `Step ${n} doesn't say what to do: it carries one of click, type, choose, reload, read, screenshot or eval.`
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
    if (verbo === "eval") {
      const code = typeof o.eval === "string" && o.eval.trim() !== "" && o.eval.length <= MAX_EVAL_CHARS ? o.eval : null;
      if (code === null) return { ok: false, error: `Step ${n}: \`eval\` has to be JavaScript of up to ${MAX_EVAL_CHARS} characters.` };
      pasos.push({ eval: code });
      continue;
    }
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
    else if (verbo === "screenshot") pasos.push({ screenshot: valor });
    else pasos.push({ read: valor });
  }
  return { ok: true, pasos };
}

/**
 * LA PESTAÑA DEL TURNO (los ojos como Claude Code, 14/10). Claude Code conduce
 * UNA sesión de navegador (`chromium-cli --session app`, o la pestaña de su
 * navegador): cada orden actúa sobre la página que hay. Aquí, igual: cada
 * `use_page` del turno sigue donde la dejó el anterior. Vive en la sesión del
 * turno y se cierra al acabarlo (o sola, sin usarse un rato). El motor
 * (`usar-pagina.ts`) es quien sabe qué hay dentro; aquí sólo su forma, para
 * que `tools.ts` la cree sin arrastrar Chromium.
 */
export interface BrowserTabHolder {
  /** La pestaña abierta (del motor), o nada. */
  current: unknown;
  /** Las visitas a la misma pestaña van en fila: dos a la vez se pisarían. */
  queue: Promise<unknown>;
  /** Cierra la pestaña si nadie la usa un rato (por si el turno no la cierra). */
  timer: ReturnType<typeof setTimeout> | null;
  /** The idle timer closed it: the next visit says so. */
  closedIdle: boolean;
}

export const newBrowserTabHolder = (): BrowserTabHolder => ({ current: null, queue: Promise.resolve(), timer: null, closedIdle: false });
