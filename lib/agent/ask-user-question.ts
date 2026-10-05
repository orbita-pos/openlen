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

/** PIEZA 7 · para qué es la pregunta cuando no es del modelo: la revisión del
 *  plan (`exit_plan_mode`) o el consentimiento para entrar en modo plan
 *  (`enter_plan_mode`). La pone SÓLO el servidor; el chat la usa para pintar la
 *  tarjeta (como el `intent` de DeepSeek: «presentation only»). */
export type QuestionIntent = { kind: "plan-review"; plan: string } | { kind: "plan-consent" };

export interface UserQuestion {
  id: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  intent?: QuestionIntent;
}

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/** Cuánto espera la pregunta a que el dueño conteste dentro del turno: el
 *  `timeout` por defecto del modo `timed` de DeepSeek (tool-ask-user, 120 s).
 *  Queda por debajo del reloj de silencio de la ruta (180 s). Al vencer NO es
 *  una aprobación: el turno cierra con la pregunta. */
export const ASK_USER_TIMEOUT_MS = 120_000;

/** LOTE 7-8 · el dueño DESCARTÓ la pregunta para hablar él: el `dismiss` del
 *  panel de DeepSeek, que rechaza la espera con `ASK_CANCELLED`. No es una
 *  respuesta ni un «no contestó»: el turno lo cierra el servidor (como Claude
 *  Code al rechazar) y lo que escriba el dueño es el turno siguiente. */
export const QUESTION_DISMISSED = "dismissed" as const;
/** Lo que devuelve la espera: las respuestas, el descarte o `null` (venció, ■). */
export type AskUserResult = QuestionAnswer[] | typeof QUESTION_DISMISSED | null;
/** El mensaje de DeepSeek para `ASK_CANCELLED` (`ui-user-questions/src/client/
 *  contract/slots.ts`, `rejectionMessages`). */
export const ASK_CANCELLED_ERROR = "the user cancelled ask_user_question";

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

/** La intención, si tiene una forma que el chat sabe pintar; si no, ninguna. */
function intentFrom(raw: unknown): QuestionIntent | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "plan-consent") return { kind: "plan-consent" };
  if (raw.kind === "plan-review" && typeof raw.plan === "string" && raw.plan.trim()) return { kind: "plan-review", plan: raw.plan };
  return null;
}

/** Las preguntas tal como llegan al chat (la forma ya normalizada del servidor,
 *  con `multiSelect`), validadas con las mismas reglas; `null` si no valen. La
 *  intención (pieza 7) se conserva aquí y sólo aquí: lo que manda el modelo
 *  pasa por `validateQuestions`, que no la conoce. */
export function questionsFrom(raw: unknown): UserQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const v = validateQuestions(
    raw.map((q) => (isObject(q) && q.multiSelect !== undefined ? { ...q, multi_select: q.multiSelect } : q)),
  );
  if (!v.ok) return null;
  return v.questions.map((q, i) => {
    const intent = intentFrom((raw[i] as Record<string, unknown>).intent);
    return intent ? { ...q, intent } : q;
  });
}

/** La(s) pregunta(s) como texto plano: para la tarjeta de antes, la voz y el
 *  cierre del turno cuando nadie contesta. */
export function questionText(questions: readonly UserQuestion[]): string {
  return questions.map((q) => q.question).join("\n");
}

/** «(Recommended)» lo escribe el modelo al final de la etiqueta (la regla de
 *  DeepSeek); al dueño se le enseña aparte, traducido. */
export const RECOMMENDED_SUFFIX = /\s*\(Recommended\)\s*$/i;

/** Lo que contestó el dueño, en una línea, para encoger la tarjeta
 *  («Respondiste: 48 horas»): lo elegido y lo escrito, pregunta a pregunta. */
export function answerSummary(answers: readonly QuestionAnswer[]): string {
  return answers
    .map((a) => [...a.selected.map((s) => s.replace(RECOMMENDED_SUFFIX, "")), ...(a.custom ? [a.custom] : [])].join(", "))
    .filter(Boolean)
    .join(" · ")
    .slice(0, 200);
}

/** ¿Es la herramienta de preguntar, con su nombre de hoy o con el de antes? */
export function isQuestionTool(name: string): boolean {
  return name === ASK_USER_QUESTION || name === LEGACY_QUESTION_TOOL;
}

/** PIEZA 7 · las herramientas que le preguntan al dueño y esperan: la pregunta
 *  y las dos del modo plan (el consentimiento para entrar, la revisión del
 *  plan). Su tarjeta es una pregunta en el chat, en la barra, en el aviso del
 *  cierre y en Len-Bench. Con los nombres en texto: `plan-mode.ts` ya importa
 *  de aquí. */
const ASKS_THE_OWNER: ReadonlySet<string> = new Set([ASK_USER_QUESTION, LEGACY_QUESTION_TOOL, "enter_plan_mode", "exit_plan_mode"]);

/** ¿Le pregunta al dueño y espera su respuesta? */
export function asksTheOwner(name: string): boolean {
  return ASKS_THE_OWNER.has(name);
}

/** Los nombres viejos que siguen valiendo en lo GUARDADO, con el de hoy. */
const LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = { [LEGACY_QUESTION_TOOL]: ASK_USER_QUESTION };

/** El nombre de hoy de una herramienta que pudo guardarse con el de antes. */
export function currentToolName(name: string): string {
  return Object.hasOwn(LEGACY_TOOL_NAMES, name) ? LEGACY_TOOL_NAMES[name] : name;
}

/** Una llamada guardada, con el nombre y la forma de hoy: `preguntar({ texto })`
 *  pasa a `ask_user_question({ questions: [{ id: "q1", question: texto }] })`,
 *  para que el modelo nunca lea una llamada a una herramienta que no tiene. */
export function currentToolCall(call: { name: string; args?: Record<string, unknown> }): { name: string; args: Record<string, unknown> } {
  const args = call.args ?? {};
  if (call.name !== LEGACY_QUESTION_TOOL) return { name: call.name, args };
  const texto = typeof args.texto === "string" ? args.texto : "";
  return { name: ASK_USER_QUESTION, args: { questions: [{ id: "q1", question: texto }] } };
}
