/**
 * EL MODO PLAN — pieza 7 de Len 2.5. Es el de DeepSeek (`deepseek-harness` @
 * 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt: `packages/plan/plan-mode/
 * src/index.ts` y la sección `plan:policy` de `packages/bundle/base/
 * cordis.patch.yml`): un ESTADO de la conversación que, mientras está activo,
 * pone su sección en el prompt de sistema; `exit_plan_mode({plan})` presenta el
 * plan para revisión por el canal de preguntas y, aprobado, lo apaga. Blando,
 * como el suyo: no bloquea ninguna herramienta (el catálogo no cambia entre
 * modos, por la caché).
 *
 * Lo de Claude Code es la conducta de la otra puerta: el modelo puede pedir
 * entrar (`enter_plan_mode`, su `EnterPlanMode` sin parámetros) y el dueño tiene
 * que aceptar. Su texto no se copia.
 *
 * Puro: lo importan las herramientas, la ruta y el chat (cliente).
 */

import type { Message } from "@/lib/ai-gateway";
import type { QuestionAnswer, UserQuestion } from "@/lib/agent/ask-user-question";

export const ENTER_PLAN_MODE = "enter_plan_mode";
/** El nombre de la herramienta de DeepSeek (`EXIT_PLAN_MODE`). */
export const EXIT_PLAN_MODE = "exit_plan_mode";

/**
 * La sección `plan:policy` del bundle base de DeepSeek. Tres adaptaciones, y
 * nada más: «project» donde dice «repository» (aquí no hay repositorio); la
 * lista de lo que no se hace nombra lo que muta en Len (ficheros, la base, los
 * ajustes, publicar) en vez de formateadores y commits; y fuera la frase de
 * `todo_write`, que Len no tiene. Más UNA frase nuestra («Write it in the
 * user's language…»): el plan lo revisa el dueño, que puede no ser técnico
 * (spec §4.4, «en palabras del dueño»), y termina con la receta de
 * verificación de punta a punta, que es lo que Claude Code pide al plan de un
 * trabajo grande.
 */
export const PLAN_POLICY = `PLAN MODE:
You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual project. Do not edit or write files, change the database or settings, publish, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions. Write it in the user's language, in words they can review without being technical, and end it with how you will verify the finished work: what you will open, try or fill in on the page, and what you expect to see.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.`;

/** Las narraciones de DeepSeek (`narration`): el dueño cambió el modo entre turnos. */
export const PLAN_ON_NOTICE = "The user switched this session to plan mode.";
export const PLAN_OFF_NOTICE = "The user switched this session back to the default mode.";

const SEPARATOR = "\n\n";

/**
 * Los mensajes con el prompt de sistema del modo que toca: la base y, activo,
 * la sección detrás. Devuelve una copia y sólo cambia `messages[0]` si es de
 * sistema; quitarla deja la base aunque ya la llevara (se llama en cada
 * petición del turno: al aprobar a media vuelta, la siguiente sale sin ella,
 * como en DeepSeek, que la evalúa por petición).
 */
export function withPlanSection(messages: readonly Message[], active: boolean): Message[] {
  const out = [...messages];
  const first = out[0];
  if (!first || first.role !== "system" || typeof first.content !== "string") return out;
  const tail = `${SEPARATOR}${PLAN_POLICY}`;
  const base = first.content.endsWith(tail) ? first.content.slice(0, -tail.length) : first.content;
  out[0] = { ...first, content: active ? `${base}${tail}` : base };
  return out;
}

/**
 * EL ESTADO AL EMPEZAR EL TURNO, plegado de la conversación como la proyección
 * `plan` de DeepSeek: la foto de la última fila CON transcripción (cada turno
 * guarda si cerró en modo plan). Un turno caído sin transcripción no lo apaga.
 */
export function planModeFromRows(rows: readonly { readonly transcript: { readonly planMode?: true } | null }[]): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rows[i]!.transcript;
    if (t) return t.planMode === true;
  }
  return false;
}

/**
 * LA PUERTA DEL DUEÑO. Lo que el dueño veía al mandar (`selected`, el pestillo
 * del cuerpo; `null` si el cliente no lo dice: la voz, Len-Bench, un cliente
 * viejo) contra lo plegado. Si difiere, gana el dueño y el modelo lo lee con la
 * narración de DeepSeek.
 */
export function resolveTurnPlanMode(o: { folded: boolean; selected: boolean | null }): { active: boolean; notice: string | null } {
  if (o.selected === null || o.selected === o.folded) return { active: o.folded, notice: null };
  return { active: o.selected, notice: o.selected ? PLAN_ON_NOTICE : PLAN_OFF_NOTICE };
}

/** Las etiquetas de la revisión de DeepSeek (`APPROVE_LABEL`, `KEEP_PLANNING_LABEL`). */
export const APPROVE_LABEL = "Approve";
export const KEEP_PLANNING_LABEL = "Keep planning";
/** Las del consentimiento para entrar (nuestras: DeepSeek no tiene esta puerta). */
export const PLAN_FIRST_LABEL = "Plan first";
export const SKIP_PLANNING_LABEL = "Skip planning";

const REVIEW_ID = "plan-review";
const CONSENT_ID = "plan-mode";

/** La pregunta de revisión de `exit_plan_mode`, con su forma de DeepSeek. */
export function planReviewQuestion(plan: string): UserQuestion {
  return {
    id: REVIEW_ID,
    header: "Plan review",
    question: "Approve this plan and leave plan mode?",
    options: [
      { label: APPROVE_LABEL, description: "Leave plan mode; the plan is carried out from the next step." },
      { label: KEEP_PLANNING_LABEL, description: "Stay in plan mode; feedback goes back to the model." },
    ],
    intent: { kind: "plan-review", plan },
  };
}

/** La pregunta de `enter_plan_mode`: el dueño tiene que aceptar (Claude Code). */
export function planConsentQuestion(): UserQuestion {
  return {
    id: CONSENT_ID,
    header: "Plan mode",
    question: "Switch to plan mode? Len explores and agrees the approach with you before changing anything.",
    options: [
      { label: PLAN_FIRST_LABEL, description: "Nothing changes until you approve the plan." },
      { label: SKIP_PLANNING_LABEL, description: "Len carries on with the request now." },
    ],
    intent: { kind: "plan-consent" },
  };
}

/** Lo elegido en UNA pregunta, si hay exactamente una respuesta para ella. */
function answerFor(answers: readonly QuestionAnswer[], id: string): QuestionAnswer | undefined {
  const items = answers.filter((a) => a.id === id);
  return items.length === 1 ? items[0] : undefined;
}

/**
 * La regla de DeepSeek: se aprueba SÓLO con «Approve» a secas; cualquier otra
 * cosa es seguir planeando, y lo escrito vuelve literal al modelo.
 */
export function reviewOutcome(answers: readonly QuestionAnswer[]): { approved: true } | { approved: false; error: string } {
  const item = answerFor(answers, REVIEW_ID);
  if (item?.selected.length === 1 && item.selected[0] === APPROVE_LABEL && item.custom === undefined) return { approved: true };
  const feedback = item?.custom ?? "";
  return {
    approved: false,
    error:
      feedback === ""
        ? "The user chose to keep planning; revise the plan and present it again."
        : `The user chose to keep planning; their feedback: ${feedback}`,
  };
}

/** ¿Aceptó el dueño entrar? Con la misma vara que la revisión: el sí a secas. */
export function consentGiven(answers: readonly QuestionAnswer[]): boolean {
  const item = answerFor(answers, CONSENT_ID);
  return item?.selected.length === 1 && item.selected[0] === PLAN_FIRST_LABEL && item.custom === undefined;
}

/** El primer encabezado Markdown del plan (`firstHeading` de DeepSeek), o `null`. */
export function planTitle(plan: string): string | null {
  for (const line of plan.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  return null;
}
