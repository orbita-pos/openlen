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
  | { readonly eval: string }
  // Los pasos de Claude Code (spec local 2026-11-05-ojos-que-ven-el-movimiento, §8.5): las acciones de
  // la herramienta `computer` de su navegador, con sus nombres. Coordenadas = píxeles CSS de la
  // pestaña, los de una captura de la pantalla. `key` PULSA (como el suyo), no mantiene.
  | { readonly key: string; readonly repeat?: number }
  | { readonly wait: number }
  | { readonly left_click: readonly [number, number] }
  | { readonly hover: readonly [number, number] }
  | { readonly left_click_drag: readonly [number, number]; readonly coordinate: readonly [number, number] }
  | { readonly zoom: readonly [number, number, number, number] };

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
const VERBOS = ["click", "type", "choose", "reload", "read", "screenshot", "eval", "key", "wait", "left_click", "hover", "left_click_drag", "zoom"] as const;
const CLAVES = new Set<string>([...VERBOS, "into", "within", "repeat", "coordinate"]);
/** El `wait` de Claude Code: «Maximum 10 seconds». */
export const MAX_WAIT_S = 10;
/** El `repeat` de Claude Code: de 1 a 100. */
const MAX_REPEAT = 100;
const LISTA_DE_PASOS =
  '{"click": "…"}, {"type": "…", "into": "…"}, {"choose": "…"}, {"reload": true}, {"read": "…"}, {"screenshot": "screen"}, {"eval": "…"}, {"key": "Enter"}, {"wait": 2}, {"left_click": [x, y]}, {"hover": [x, y]}, {"left_click_drag": [x, y], "coordinate": [x, y]} or {"zoom": [x0, y0, x1, y1]}';

const MODIFICADORES: Record<string, string> = { ctrl: "Control", control: "Control", shift: "Shift", alt: "Alt", option: "Alt", cmd: "Meta", command: "Meta", meta: "Meta", win: "Meta", super: "Meta" };
const TECLAS: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  space: "Space",
  spacebar: "Space",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "ArrowUp",
  up: "ArrowUp",
  arrowdown: "ArrowDown",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  left: "ArrowLeft",
  arrowright: "ArrowRight",
  right: "ArrowRight",
};

/**
 * Una tecla o combinación como las del `key` de Claude Code («Enter», «ctrl+a») a nombres de
 * Puppeteer (`KeyInput`): los modificadores delante, la tecla al final.
 */
export function parseKey(text: string): { readonly ok: true; readonly combos: string[][] } | { readonly ok: false; readonly error: string } {
  const malo = {
    ok: false as const,
    error: `"${text}" isn't a key name. Use names like "Enter", "Escape", "Tab", "Backspace", "Space", "ArrowLeft", "PageDown", "F5" or one character like "a", combinations like "ctrl+k" or "shift+Tab", and several separated by spaces like "Backspace Backspace".`,
  };
  const t = text.trim();
  if (t === "") return malo;
  // Several keys separated by spaces, one after the other — Claude Code's `key` («"Backspace Backspace Delete"»).
  const combos: string[][] = [];
  for (const combo of t.split(/\s+/)) {
    const partes = combo === "+" ? ["+"] : combo.split("+");
    const keys: string[] = [];
    for (const [i, p] of partes.entries()) {
      const bajo = p.toLowerCase();
      const ultima = i === partes.length - 1;
      const mod = MODIFICADORES[bajo];
      if (mod && (!ultima || partes.length === 1)) {
        keys.push(mod);
        continue;
      }
      if (!ultima || p === "") return malo;
      const tecla = TECLAS[bajo] ?? (/^f([1-9]|1[0-2])$/.test(bajo) ? bajo.toUpperCase() : [...p].length === 1 ? p : null);
      if (!tecla) return malo;
      keys.push(tecla);
    }
    combos.push(keys);
  }
  return { ok: true, combos };
}

/** Dos (o cuatro) números finitos de 0 o más. */
const coordenadas = (v: unknown, n: 2 | 4): number[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) ? (v as number[]) : null;

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
  const screenshots = bruto.filter(
    (p) => p && typeof p === "object" && ((p as Record<string, unknown>).screenshot !== undefined || (p as Record<string, unknown>).zoom !== undefined),
  ).length;
  if (screenshots > MAX_SCREENSHOTS_PER_VISIT) {
    return { ok: false, error: `A visit takes at most ${MAX_SCREENSHOTS_PER_VISIT} screenshots and this one asks for ${screenshots}. Keep the ones that show what you need to see.` };
  }
  const pasos: PasoDeUso[] = [];
  for (const [i, p] of bruto.entries()) {
    const n = i + 1;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      return {
        ok: false,
        error: `Step ${n} isn't an object: each step is ${LISTA_DE_PASOS}.`,
      };
    }
    const o = p as Record<string, unknown>;
    const extra = Object.keys(o).find((k) => !CLAVES.has(k));
    if (extra) {
      return {
        ok: false,
        error: `Step ${n} brings an unexpected parameter \`${extra}\`. The ones there are: click, type + into, choose, reload, read, screenshot, eval, key (+ repeat), wait, left_click, hover, left_click_drag + coordinate, zoom, and within with click or choose.`,
      };
    }
    const verbos = VERBOS.filter((v) => o[v] !== undefined);
    if (verbos.length !== 1) {
      return {
        ok: false,
        error:
          verbos.length === 0
            ? `Step ${n} doesn't say what to do: it carries one of click, type, choose, reload, read, screenshot, eval, key, wait, left_click, hover, left_click_drag or zoom.`
            : `Step ${n} carries ${verbos.map((v) => `\`${v}\``).join(" and ")}: each step does ONE thing. Split it into several steps.`,
      };
    }
    const verbo = verbos[0]!;
    if (o.coordinate !== undefined && verbo !== "left_click_drag") {
      return { ok: false, error: `Step ${n}: \`coordinate\` only goes with \`left_click_drag\` (where the drag ends).` };
    }
    if (o.repeat !== undefined && verbo !== "key") return { ok: false, error: `Step ${n}: \`repeat\` only goes with \`key\` (how many times to press it).` };
    const enPixeles = "pixels of the tab, as in a screenshot of the screen (1280×900 on a desktop)";
    if (verbo === "key") {
      const k = typeof o.key === "string" ? parseKey(o.key) : null;
      if (!k || !k.ok) return { ok: false, error: `Step ${n}: \`key\`: ${k && !k.ok ? k.error : "it has to be a key name, like \"Enter\" or \"ctrl+k\"."}` };
      if (o.repeat !== undefined && (typeof o.repeat !== "number" || !Number.isInteger(o.repeat) || o.repeat < 1 || o.repeat > MAX_REPEAT)) {
        return { ok: false, error: `Step ${n}: \`repeat\` is how many times to press the key, from 1 to ${MAX_REPEAT}.` };
      }
      pasos.push(o.repeat !== undefined ? { key: (o.key as string).trim(), repeat: o.repeat as number } : { key: (o.key as string).trim() });
      continue;
    }
    if (verbo === "wait") {
      if (typeof o.wait !== "number" || !Number.isFinite(o.wait) || o.wait <= 0 || o.wait > MAX_WAIT_S) {
        return { ok: false, error: `Step ${n}: \`wait\` is seconds, more than 0 and up to ${MAX_WAIT_S}.` };
      }
      pasos.push({ wait: o.wait });
      continue;
    }
    if (verbo === "left_click" || verbo === "hover") {
      const c = coordenadas(o[verbo], 2);
      if (!c) return { ok: false, error: `Step ${n}: \`${verbo}\` has to be [x, y]: two numbers of 0 or more, ${enPixeles}.` };
      pasos.push(verbo === "left_click" ? { left_click: [c[0]!, c[1]!] } : { hover: [c[0]!, c[1]!] });
      continue;
    }
    if (verbo === "left_click_drag") {
      const desde = coordenadas(o.left_click_drag, 2);
      if (!desde) return { ok: false, error: `Step ${n}: \`left_click_drag\` has to be [x, y], where the drag starts: two numbers of 0 or more, ${enPixeles}.` };
      if (o.coordinate === undefined) return { ok: false, error: `Step ${n}: \`left_click_drag\` needs \`coordinate\`, the [x, y] where the drag ends.` };
      const hasta = coordenadas(o.coordinate, 2);
      if (!hasta) return { ok: false, error: `Step ${n}: \`coordinate\` has to be [x, y], where the drag ends: two numbers of 0 or more, ${enPixeles}.` };
      pasos.push({ left_click_drag: [desde[0]!, desde[1]!], coordinate: [hasta[0]!, hasta[1]!] });
      continue;
    }
    if (verbo === "zoom") {
      const z = coordenadas(o.zoom, 4);
      if (!z || z[2]! <= z[0]! || z[3]! <= z[1]!) {
        return { ok: false, error: `Step ${n}: \`zoom\` has to be [x0, y0, x1, y1]: the top-left and bottom-right corners of a region, ${enPixeles}.` };
      }
      pasos.push({ zoom: [z[0]!, z[1]!, z[2]!, z[3]!] });
      continue;
    }
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
