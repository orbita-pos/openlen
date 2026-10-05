/**
 * LAS DOS HERRAMIENTAS DEL MODO PLAN — pieza 7 de Len 2.5.
 *
 * `exit_plan_mode` es la de DeepSeek (`deepseek-harness` @ 5badb15, MIT,
 * LICENSES/deepseek-harness.MIT.txt: `packages/plan/plan-mode/src/index.ts`):
 * su descripción, su parámetro, sus errores y su resultado, copiados; presenta
 * el plan por el canal de preguntas (el de la pieza 3) y, aprobado, apaga el
 * modo para la petición siguiente.
 *
 * `enter_plan_mode` es la puerta de Claude Code (`EnterPlanMode`): sin
 * parámetros, para un trabajo que no es trivial, y el dueño tiene que aceptar.
 * DeepSeek no la tiene (allí sólo entra el usuario con `/plan`). Su texto es
 * NUESTRO: los siete casos de Claude Code dichos para una página y alguien que
 * puede no ser técnico.
 *
 * El estado lo guarda la ruta (`AgentDeps.planMode`); el módulo puro es
 * `lib/agent/plan-mode.ts`.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { QUESTION_DISMISSED, answerSummary, questionText } from "@/lib/agent/ask-user-question";
import {
  ENTER_PLAN_MODE,
  EXIT_PLAN_MODE,
  PLAN_REVIEW_DISMISSED_ERROR,
  consentGiven,
  planConsentQuestion,
  planReviewQuestion,
  reviewOutcome,
} from "@/lib/agent/plan-mode";

export const PLAN_MODE_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: ENTER_PLAN_MODE,
    description:
      "Ask the user to switch this conversation to plan mode before a change that isn't trivial, so you explore first and agree on the approach instead of redoing work. "
      + "Use it when any of these is true: the request adds something new (a section, a page, a form, a feature); it can be done in more than one reasonable way; "
      + "it changes how something that already works behaves; it means choosing between approaches (where the data lives, how something is laid out); "
      + "it will touch more than two or three files; the request is vague and you need to look before you know how big it is; "
      + "or the result depends on the user's taste — if you were about to ask them how they want it, plan instead. "
      + "Skip it for small, clear changes (a text, a color, an obvious fix) and when the user already said exactly what they want. When unsure, plan. "
      + "The user must accept; if they decline, carry on with the request without plan mode.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: EXIT_PLAN_MODE,
    description:
      "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. "
      + "The user may approve (carry out the plan from your next step) or keep "
      + "planning — their feedback comes back in the tool result; revise and present again.",
    parameters: {
      type: "OBJECT",
      properties: {
        plan: { type: "STRING", description: "The complete plan, as markdown, starting with a # heading that names it." },
      },
      required: ["plan"],
    },
  },
];

/** La puerta del modelo: pregunta, y sólo un sí a secas enciende el modo. */
export async function toolEnterPlanMode(
  _session: AgentSession,
  deps: AgentDeps,
  _args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (!deps.planMode || !deps.askUser) {
    return {
      response: {
        ok: false,
        error: "Plan mode needs the user's consent and this conversation can't ask for it; carry on without plan mode.",
      },
    };
  }
  if (deps.planMode.active()) {
    return { response: { ok: false, error: "Already in plan mode; present the plan with exit_plan_mode when it is ready." } };
  }
  const preguntas = [planConsentQuestion()];
  const answers = await deps.askUser(preguntas);
  // Sin respuesta a tiempo (o ■): como `ask_user_question`, la pregunta cierra
  // el turno. Si el dueño acepta después, el chat enciende el modo con su
  // mensaje (la puerta del dueño), así que aquí no se toca nada. Lote 7-8:
  // descartada (sólo por la API: esta tarjeta no tiene «Pedir cambios»), igual.
  if (!answers || answers === QUESTION_DISMISSED) {
    return { response: { ok: true, preguntado: true }, pregunta: questionText(preguntas), preguntas };
  }
  const respuesta = answerSummary(answers);
  if (!consentGiven(answers)) {
    return { response: { ok: false, error: "The user declined plan mode; carry on with the request without it." }, preguntas, respuesta };
  }
  deps.planMode.set(true);
  return {
    response: { ok: true, planMode: true, result: "Plan mode on: explore and design first, then present the plan with exit_plan_mode." },
    preguntas,
    respuesta,
  };
}

/** La de DeepSeek: el plan se revisa y, aprobado, el modo se apaga. */
export async function toolExitPlanMode(
  _session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (!deps.planMode?.active()) return { response: { ok: false, error: `${EXIT_PLAN_MODE} is only available in plan mode` } };
  const plan = typeof args.plan === "string" ? args.plan.trim() : "";
  if (!/^#\s+\S/.test(plan)) {
    return { response: { ok: false, error: `${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading` } };
  }
  if (!deps.askUser) {
    return {
      response: {
        ok: false,
        error: "no user-questions channel is available to review the plan; ask the user to switch the session mode instead",
      },
    };
  }
  const preguntas = [planReviewQuestion(plan)];
  const answers = await deps.askUser(preguntas);
  // 🔴 `null` (no contestó a tiempo, ■) NUNCA aprueba: el turno cierra con la
  // tarjeta y el modo sigue. Si aprueba después, el chat lo apaga con su mensaje.
  if (!answers) return { response: { ok: true, preguntado: true }, pregunta: questionText(preguntas), preguntas };
  // LOTE 7-8 · DESCARTADA para hablar (el «discuss» de DeepSeek): su error
  // literal, el modo sigue y el bucle cierra el turno; lo que escriba el dueño
  // es el turno siguiente, todavía en modo plan.
  if (answers === QUESTION_DISMISSED) return { response: { ok: false, error: PLAN_REVIEW_DISMISSED_ERROR }, preguntas, dismissed: true };
  const respuesta = answerSummary(answers);
  const outcome = reviewOutcome(answers);
  if (!outcome.approved) return { response: { ok: false, error: outcome.error }, preguntas, respuesta };
  deps.planMode.set(false);
  return {
    response: { ok: true, approved: true, result: "Plan approved — plan mode exited; carry out the plan starting with your next step." },
    preguntas,
    respuesta,
  };
}
