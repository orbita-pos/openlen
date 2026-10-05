/**
 * LA PREGUNTA DE LEN — pieza 3 de Len 2.5: `ask_user_question` de DeepSeek
 * (`deepseek-harness` @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt:
 * `packages/interaction/tool-ask-user/src/index.ts`), con su nombre y su forma:
 * una o varias preguntas, cada una con su `id`, opciones de etiqueta + una
 * frase (la recomendada primero, con «(Recommended)»), y selección múltiple.
 * La respuesta, como la suya: `{ id, selected, custom? }` por pregunta.
 *
 * Puro: lo importan el catálogo, las herramientas, el almacén de turnos, el
 * saneado del historial y el chat (cliente).
 */

export const ASK_USER_QUESTION = "ask_user_question";
/** Cómo se llamaba hasta la pieza 3. Sólo vale en lo GUARDADO (historial,
 *  transcripción, tarjetas, grabaciones); el modelo ya no lo ve. */
export const LEGACY_QUESTION_TOOL = "preguntar";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/** Una pregunta, no un ensayo: lo que no quepa aquí es el modelo pensando en
 *  voz alta, y eso va en su texto. 600 era el tope de `preguntar`. */
const QUESTION_MAX = 600;
const HEADER_MAX = 40;
const LABEL_MAX = 120;
const DESCRIPTION_MAX = 300;
const OPTIONS_MAX = 10;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Valida la forma de DeepSeek ANTES de enseñarle nada al dueño. Los errores le
 *  hablan al modelo y dicen qué cambiar. */
export function validateQuestions(raw: unknown): { ok: true; questions: UserQuestion[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: '"questions" must be a non-empty array of { id, question, header?, options?, multi_select? }.' };
  }
  const questions: UserQuestion[] = [];
  const ids = new Set<string>();
  for (const [i, q] of raw.entries()) {
    if (!isObject(q)) return { ok: false, error: `questions[${i}] must be an object.` };
    const id = text(q.id);
    if (!id) return { ok: false, error: `questions[${i}] needs an "id": a short stable name, echoed in the answer.` };
    if (ids.has(id)) return { ok: false, error: `question ids must be unique within the call; "${id}" is repeated.` };
    ids.add(id);
    const question = text(q.question).slice(0, QUESTION_MAX);
    if (!question) return { ok: false, error: `questions[${i}] ("${id}") needs "question": the question exactly as the user will read it.` };
    const out: UserQuestion = { id, question };
    const header = text(q.header).slice(0, HEADER_MAX);
    if (header) out.header = header;
    if (q.options !== undefined) {
      if (!Array.isArray(q.options)) return { ok: false, error: `questions[${i}].options must be an array of { label, description? }.` };
      const options: QuestionOption[] = [];
      for (const [j, o] of q.options.slice(0, OPTIONS_MAX).entries()) {
        const label = isObject(o) ? text(o.label).slice(0, LABEL_MAX) : "";
        if (!label) return { ok: false, error: `questions[${i}].options[${j}] needs a "label": the short text on the button.` };
        const description = isObject(o) ? text(o.description).slice(0, DESCRIPTION_MAX) : "";
        options.push(description ? { label, description } : { label });
      }
      if (options.length > 0) out.options = options;
    }
    if (typeof q.multi_select === "boolean") out.multiSelect = q.multi_select;
    questions.push(out);
  }
  return { ok: true, questions };
}

/** La(s) pregunta(s) como texto plano: para la tarjeta de antes, la voz y el
 *  cierre del turno cuando nadie contesta. */
export function questionText(questions: readonly UserQuestion[]): string {
  return questions.map((q) => q.question).join("\n");
}

/** ¿Es la herramienta de preguntar, con su nombre de hoy o con el de antes? */
export function isQuestionTool(name: string): boolean {
  return name === ASK_USER_QUESTION || name === LEGACY_QUESTION_TOOL;
}
