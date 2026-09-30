// lib/agent/revision/receta.ts — H14, los «segundos ojos»: la receta de `/code-review` de Claude Code.
//
// PASO 8 DE LEN 2.5 (2026-09-29, OK de Jesús: «sigue con el 8 siguiendo a
// Claude Code»). Claude Code ya hace que el MISMO modelo revise el trabajo del
// mismo modelo, y lo que lo hace fiable no es el modelo sino la RECETA (`/code-review`):
//   · el alcance es el diff («…»);
//   · buscadores separados, uno por ÁNGULO, cada uno con contexto limpio, hasta
//     6 candidatos con `file`, `line`, `summary` y `failure_scenario`;
//   · el buscador NO se censura: «…»;
//   · un verificador por candidato, con tres salidas (CONFIRMED / PLAUSIBLE /
//     REFUTED) y refutar sólo citando la línea;
//   · la proporción por esfuerzo: bajo, una pasada sin verificar y ≤4; medio,
//     precisión («…») y ≤8.
// Y de la skill `verify`: «…»
//
// Los ÁNGULOS son los de Len, no los de código (ficha
// `plans/len-2/hipotesis/H14-revision-con-ojos-limpios.md`): los dos fallos que
// le quedan son salirse de lo pedido e inventar. Nada de la lógica del JS: un
// revisor que no es más fuerte que el autor empeora ahí, y el JS ya tiene sus
// puertas deterministas.
//
// El texto va en inglés, como el de Claude Code del que sale y como los
// errores de las herramientas de Len. Puro: prompts y lectura de respuestas.

export type Angulo = "alcance" | "quitado" | "procedencia" | "dicho";
export type Veredicto = "CONFIRMED" | "PLAUSIBLE" | "REFUTED";

export const ANGULOS_EN_ORDEN: readonly Angulo[] = ["alcance", "quitado", "procedencia", "dicho"];

/** El `category` de la pasada única, el slug del ángulo como en `ReportFindings`. */
const CATEGORIA: Readonly<Record<Angulo, string>> = {
  alcance: "scope",
  quitado: "removed",
  procedencia: "provenance",
  dicho: "said-vs-done",
};

export interface Candidato {
  readonly file: string;
  /** La línea en la versión NUEVA del fichero; `null` si nada del fichero la
   *  marca (algo pedido que el diff no hace). No se inventa una: una línea
   *  falsa manda a Len a mirar donde no es. */
  readonly line: number | null;
  readonly summary: string;
  readonly failure_scenario: string;
  /** El ángulo que lo trajo: el del buscador, o el `category` de la pasada
   *  única si lo dijo. */
  readonly angulo?: Angulo;
}

/** Cuántos candidatos puede traer un buscador (el «up to 6 each» de Claude Code). */
export const MAX_POR_BUSCADOR = 6;

const ANGULOS: Readonly<Record<Angulo, string>> = {
  alcance: `### Angle A — scope

The request is the deliverable: the change must not narrow it, widen it, or transform it silently. For every change in the diff, find the sentence of the user's request that asked for it — this turn's, or an earlier message of theirs that it continues — and quote it. A change no sentence asks for is a candidate: a section rewritten, a style or a text changed, a page or a feature added that nobody mentioned. A change the request needed in order to work (a menu link to a page the user asked for) is not. Then the other direction: for every thing the request asks for, find it in the diff. Something asked for that the diff does not do is a candidate too.`,
  quitado: `### Angle B — removed-content … what it did for the page: a text, a datum (a phone, a price, a name, an address), a link, a working control, a script behavior, a style. Then check two things: did the user's request ask for it to go, and is it re-established somewhere in the new version (look at the diff, and Grep the site)? If neither, that's a candidate: a brand phrase, a phone number, a working button, or a handler removed without being asked.`,
  procedencia: `### Angle C — provenance of new data

For every datum the diff ADDS — a price, a figure, a date, a review or testimonial, a phone, an email, an address, a person's or business name, a URL, a claim such as "free shipping" or "20 years of experience" — find where it comes from: a sentence the user wrote (this turn or earlier), or text the site already had before this change (the diff's context and removed lines, or Grep the site). Quote the source. A datum with no source is a candidate: invented data looks true to the visitor. Visibly marked placeholders (href="#", "[YOUR PRICE]") are not invented.`,
  dicho: `### Angle D — what was said against what was done

The diff is ground truth. The agent's closing message is a claim about it. For each thing the message says was done, find it in the diff. For each change in the diff the user would notice, check that the message says it. If they disagree, that's a candidate: said but not done, done but not said, or said differently from how it was done. Claims the diff cannot show (that something was tested, how it looks) are out of scope.`,
};

/**
 * EL PROMPT DE SISTEMA DE TODOS LOS REVISORES, el mismo para cada uno.
 *
 * El orden de lo que recibe cada revisor es: esto, la tarea (petición, diff y
 * cierre: `tareaDeRevision`) y, AL FINAL, su encargo (su ángulo, la pasada
 * única o el candidato que verifica). Así los dos primeros mensajes son iguales
 * para todos los revisores de un turno y se leen de caché: el diff de un turno
 * que crea seis páginas son ~180 K caracteres, y con el ángulo delante cada
 * revisor lo pagaba entero. Es la regla de c9 §15: lo que es igual para todos,
 * primero.
 */
export const SISTEMA_DEL_REVISOR = `You review a change that an AI agent (Len) just made to a user's website. You did not make it and you do not see the agent's conversation. The next message holds the user's request for this turn (with, for context, what the user wrote earlier in the conversation), the diff of this turn, and the agent's closing message; the message after it says what to do with them. You can read the site's files with Read, Grep and Glob (read-only). The files are the site as it is now, after the change.`;

const FORMA = `Each candidate has \`file\` (the site path, e.g. /index.html), \`line\` (in the new version of the file, as the diff's hunks number it; for removed content, where it used to be; \`null\` when nothing in the file marks it, such as something requested that the diff does not do), … \`…\`, … \`…\`: what the user or a visitor sees go wrong because of it.`;

const NO_TE_CENSURES = `… — finders that silently drop half-….`;

const SALIDA = (max: number, conCategoria = false) => `## Output

Return only a JSON array of at most ${max} objects, most severe first:

\`\`\`json
[{"file": "/index.html", "line": 123, "summary": "one-sentence statement", "failure_scenario": "what goes wrong, concretely"${
  conCategoria ? `, "category": "${CATEGORIA.alcance}"` : ""
}}]
\`\`\`
${
  conCategoria
    ? `\n\`category\` is the angle that produced it: ${ANGULOS_EN_ORDEN.map((a) => `\`${CATEGORIA[a]}\``).join(", ")}.\n`
    : ""
}
If nothing qualifies, return \`[]\`.`;

/** El encargo del buscador de UN ángulo (esfuerzo medio: un subagente por ángulo). */
export function encargoDelBuscador(angulo: Angulo): string {
  return [
    `Review this change for ONE angle only. Surface up to ${MAX_POR_BUSCADOR} candidate findings. ${FORMA}`,
    "",
    ANGULOS[angulo],
    "",
    NO_TE_CENSURES,
    "",
    SALIDA(MAX_POR_BUSCADOR),
  ].join("\n");
}

/** Cuántos hallazgos da la pasada única (el «≤4 findings» del esfuerzo bajo). */
export const MAX_UNA_PASADA = 4;

/** El encargo de la pasada única (esfuerzo bajo): todos los ángulos, un revisor, sin verificar. */
export function encargoDeUnaPasada(): string {
  return [
    `Work through the four angles below yourself, in one pass. ${FORMA} Keep only findings you can ….`,
    "",
    ANGULOS.alcance,
    "",
    ANGULOS.quitado,
    "",
    ANGULOS.procedencia,
    "",
    ANGULOS.dicho,
    "",
    SALIDA(MAX_UNA_PASADA, true),
  ].join("\n");
}

/**
 * El encargo del verificador de UN candidato: tres salidas, y refutar sólo con
 * la cita. El candidato va con sus cuatro campos, en la forma en que lo
 * devolvió el buscador: el ángulo es nuestro y no le dice nada.
 */
export function encargoDelVerificador(c: Candidato): string {
  const { file, line, summary, failure_scenario } = c;
  return [
    "Another reviewer flagged the candidate finding below. Verify it: check it against the diff and the site's files.",
    "",
    "<candidate>",
    JSON.stringify({ file, line, summary, failure_scenario }),
    "</candidate>",
    "",
    "Return exactly one of:",
    "- **CONFIRMED** — you can name what triggers it and what goes wrong. Quote the line.",
    "- **PLAUSIBLE** — the mechanism is real, the trigger is uncertain. State what would confirm it.",
    "- **REFUTED** — factually wrong (the diff or the files do not say that), or the user asked for it (this turn or earlier), or the datum has a source. Quote the line or the user's sentence that proves it.",
    "",
    'Return only this JSON: {"verdict": "CONFIRMED" | "PLAUSIBLE" | "REFUTED", "evidence": "the quote"}',
  ].join("\n");
}

/**
 * Lo que recibe cada revisor: lo mismo para todos, así va casi entero en caché.
 *
 * `anteriores` son los mensajes que el USUARIO escribió en turnos anteriores —lo
 * suyo, nunca lo de Len—: el que pide reseñas y las da en el turno siguiente no
 * pidió en éste lo que Len escribe con ellas, y sin su mensaje anterior el
 * revisor las tomaría por inventadas.
 */
export function tareaDeRevision(o: {
  readonly peticion: string;
  readonly diff: string;
  readonly cierre: string;
  readonly anteriores?: readonly string[];
}): string {
  const anteriores = (o.anteriores ?? []).map((m) => m.trim()).filter(Boolean);
  return [
    ...(anteriores.length > 0
      ? ["<earlier_user_messages>", ...anteriores.map((m, i) => `[${i + 1}] ${m}`), "</earlier_user_messages>", ""]
      : []),
    "<user_request>",
    o.peticion.trim(),
    "</user_request>",
    "",
    "<diff>",
    o.diff.trim(),
    "</diff>",
    "",
    "<agent_closing_message>",
    o.cierre.trim() || "(the agent wrote no closing message)",
    "</agent_closing_message>",
  ].join("\n");
}

/**
 * El primer valor JSON de la respuesta que cumple `sirve`, o `undefined`.
 *
 * Se prueba desde CADA `[` o `{`, cerrando por profundidad y saltando lo que va
 * entre comillas, y no «del primer `[` al último `]`»: la respuesta puede traer
 * antes prosa con corchetes («[Line 12]») o CSS con llaves citado como
 * evidencia, y el corte ingenuo junta las dos cosas y no parsea.
 */
function primerJson<T>(raw: string, sirve: (v: unknown) => v is T): T | undefined {
  for (let i = 0; i < raw.length; i++) {
    const abre = raw[i];
    if (abre !== "[" && abre !== "{") continue;
    const cierra = abre === "[" ? "]" : "}";
    let profundidad = 0;
    let enCadena = false;
    for (let j = i; j < raw.length; j++) {
      const c = raw[j];
      if (enCadena) {
        if (c === "\\") j++;
        else if (c === '"') enCadena = false;
        continue;
      }
      if (c === '"') enCadena = true;
      else if (c === abre) profundidad++;
      else if (c === cierra && --profundidad === 0) {
        try {
          const v: unknown = JSON.parse(raw.slice(i, j + 1));
          if (sirve(v)) return v;
        } catch {
          // no era JSON: se sigue buscando desde el siguiente
        }
        break;
      }
    }
  }
  return undefined;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Un array de candidatos: vacío, o con algún objeto. Un `[1, 2]` citado en la
 *  prosa de delante no lo es. */
const esArray = (v: unknown): v is unknown[] => Array.isArray(v) && (v.length === 0 || v.some(esObjeto));

const DE_CATEGORIA = new Map(ANGULOS_EN_ORDEN.map((a) => [CATEGORIA[a], a]));

/**
 * Los candidatos de una respuesta. Lo que no tiene la forma se descarta uno a
 * uno; una respuesta ilegible da `null`, que NO es «sin hallazgos»: quien
 * llama lo cuenta aparte.
 */
export function leerCandidatos(raw: string, max: number): Candidato[] | null {
  const arr = primerJson(raw, esArray);
  if (!arr) return null;
  const out: Candidato[] = [];
  for (const x of arr) {
    if (!esObjeto(x)) continue;
    const file = typeof x.file === "string" ? x.file.trim() : "";
    const line = typeof x.line === "number" ? x.line : typeof x.line === "string" ? Number(x.line) : NaN;
    const summary = typeof x.summary === "string" ? x.summary.trim() : "";
    const failure_scenario = typeof x.failure_scenario === "string" ? x.failure_scenario.trim() : "";
    if (!file || !summary || !failure_scenario) continue;
    const angulo = typeof x.category === "string" ? DE_CATEGORIA.get(x.category.trim().toLowerCase()) : undefined;
    out.push({
      file: file.startsWith("/") ? file : `/${file}`,
      line: Number.isFinite(line) && line >= 1 ? Math.floor(line) : null,
      summary,
      failure_scenario,
      ...(angulo ? { angulo } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

const VEREDICTOS: readonly Veredicto[] = ["CONFIRMED", "PLAUSIBLE", "REFUTED"];

/** El voto del verificador, o `null` si no se entiende. */
export function leerVeredicto(raw: string): { veredicto: Veredicto; evidencia: string } | null {
  const o = primerJson(raw, (v): v is Record<string, unknown> => esObjeto(v) && "verdict" in v);
  if (!o) return null;
  const v = typeof o.verdict === "string" ? (o.verdict.trim().toUpperCase() as Veredicto) : null;
  if (!v || !VEREDICTOS.includes(v)) return null;
  return { veredicto: v, evidencia: typeof o.evidence === "string" ? o.evidence.trim() : "" };
}
