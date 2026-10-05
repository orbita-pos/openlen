/**
 * LAS TRES HERRAMIENTAS DEL ENCARGO — pieza 8 de Len 2.5. Son las de DeepSeek
 * (`deepseek-harness` @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt:
 * `packages/goal/tool-goal/src/index.ts` y `authority.ts`): `get_goal`,
 * `create_goal` y `update_goal`, con sus descripciones, su autoridad y sus
 * errores, copiados. La autoridad es la suya: crear, editar, pausar y reanudar,
 * sólo en un turno del DUEÑO; completar y atascar, también en la ronda en curso
 * del encargo, y atascar en una ronda sólo desde la 3.
 *
 * El estado lo guarda la ruta (`AgentDeps.goal`): la foto que se escribe al
 * cerrar el turno y la activación del proceso. El dominio es `goal.ts`.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import {
  BLOCKED_AFTER_ROUNDS,
  GOAL_GUIDANCE,
  GoalError,
  blockGoal,
  completeGoal,
  createGoal,
  editGoal,
  goalValue,
  goalWrapup,
  pauseGoal,
  resumeGoal,
  type GoalRef,
} from "@/lib/agent/goal";

export const GET_GOAL = "get_goal";
export const CREATE_GOAL = "create_goal";
export const UPDATE_GOAL = "update_goal";

const UPDATE_ACTIONS = ["edit", "pause", "resume", "complete", "blocked"] as const;
type UpdateAction = (typeof UPDATE_ACTIONS)[number];

/** La sección `tool:goal` de DeepSeek, para el prompt (siempre: el catálogo no cambia). */
export const GOAL_PROMPT = GOAL_GUIDANCE;

export const GOAL_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: GET_GOAL,
    description: "Read the current session goal, including the id and revision that update_goal requires.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: CREATE_GOAL,
    description:
      "Create a persisted goal that keeps this session working across automatic continuation rounds. " +
      'Use it when the direct human request is a long-running objective, even if the user did not say "goal"; ' +
      "not for single-turn work.",
    parameters: {
      type: "OBJECT",
      properties: {
        objective: { type: "STRING", description: "The concrete completion objective inferred from the direct human request." },
        max_goal_rounds: { type: "NUMBER", description: "Optional positive safe-integer limit on automatic continuation rounds." },
      },
      required: ["objective"],
    },
  },
  {
    name: UPDATE_GOAL,
    description: "Update the current goal.",
    parameters: {
      type: "OBJECT",
      properties: {
        goal_id: { type: "STRING", description: "Exact id returned by get_goal." },
        revision: { type: "NUMBER", description: "Exact positive revision returned by get_goal." },
        action: {
          type: "STRING",
          enum: [...UPDATE_ACTIONS],
          description:
            "edit, pause, and resume require a direct top-level human request. complete and blocked are also allowed " +
            "during an automatic continuation of this goal; blocked is rejected before the configured minimum round count.",
        },
        objective: { type: "STRING", description: "Replacement objective; valid only with action edit." },
        max_goal_rounds: { type: "NUMBER", description: "Replacement cap; valid only with action edit." },
        blocked_reason: {
          type: "STRING",
          description: "Required only with action blocked: the concrete condition that persisted across rounds and blocks progress.",
        },
      },
      required: ["goal_id", "revision", "action"],
    },
  },
];

/** Un fallo de política, con el texto de DeepSeek, como resultado (`ok: false`). */
class GoalToolError extends Error {}

const fail = (message: string): ToolOutcome => ({ response: { ok: false, error: message } });

/** Texto que significa algo, no el relleno de un esquema estricto (`hasText`). */
function hasText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Un tope que significa algo, no el `0` de relleno (`hasRoundCap`). */
function hasRoundCap(value: unknown): value is number {
  return value !== undefined && value !== null && value !== 0;
}

function goalRef(goalId: unknown, revision: unknown): GoalRef {
  if (
    typeof goalId !== "string" ||
    goalId.length === 0 ||
    goalId !== goalId.trim() ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new GoalToolError("goal_id must be non-empty and revision must be a positive safe integer");
  }
  return { id: goalId, revision };
}

type GoalDeps = NonNullable<AgentDeps["goal"]>;

/** El encargo del turno, o el error de DeepSeek si no hay turno abierto. */
function goalDeps(deps: AgentDeps): GoalDeps {
  if (!deps.goal || deps.goal.authority() === null) throw new GoalToolError("goal tools require an open model turn");
  return deps.goal;
}

function requireDirectHuman(goal: GoalDeps): void {
  if (goal.authority()?.kind === "direct-human") return;
  throw new GoalToolError("this goal operation requires a direct human turn on a top-level agent");
}

/** El resultado: la salida de DeepSeek, con el `ok` de las herramientas de Len. */
function value(goal: GoalDeps): ToolOutcome {
  return { response: { ok: true, ...goalValue(goal.get(), goal.activation()) } };
}

/** Los errores del dominio y de la política vuelven al modelo como resultado. */
async function guarded(run: () => ToolOutcome): Promise<ToolOutcome> {
  try {
    return run();
  } catch (e) {
    if (e instanceof GoalToolError || e instanceof GoalError) return fail(e.message);
    throw e;
  }
}

export async function toolGetGoal(_session: AgentSession, deps: AgentDeps, _args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(() => value(goalDeps(deps)));
}

export async function toolCreateGoal(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(() => {
    const goal = goalDeps(deps);
    requireDirectHuman(goal);
    const created = createGoal(
      goal.get(),
      { objective: args.objective, ...(args.max_goal_rounds === undefined ? {} : { maxGoalRounds: args.max_goal_rounds }) },
      goal.newId(),
    );
    goal.commit(created, "armed");
    return value(goal);
  });
}

export async function toolUpdateGoal(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  return guarded(() => {
    const goal = goalDeps(deps);
    const ref = goalRef(args.goal_id, args.revision);
    const action = args.action as UpdateAction;
    if (!UPDATE_ACTIONS.includes(action)) {
      throw new GoalToolError(`action must be one of ${UPDATE_ACTIONS.join(", ")}`);
    }
    const replacements = {
      ...(hasText(args.objective) ? { objective: args.objective } : {}),
      ...(hasRoundCap(args.max_goal_rounds) ? { maxGoalRounds: args.max_goal_rounds } : {}),
    };
    const current = goal.get();

    if (action === "edit") {
      requireDirectHuman(goal);
      if (hasText(args.blocked_reason)) throw new GoalToolError("blocked_reason is valid only with action blocked");
      goal.commit(editGoal(current, ref, replacements), goal.activation());
      return value(goal);
    }

    if (action === "pause" || action === "resume") {
      requireDirectHuman(goal);
      if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds) || hasText(args.blocked_reason)) {
        throw new GoalToolError(
          "objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked",
        );
      }
      if (action === "resume" && current?.id === ref.id && current.revision === ref.revision && current.phase === "paused") {
        throw new GoalToolError("the model cannot resume a paused goal; the user must resume it");
      }
      if (action === "pause") goal.commit(pauseGoal(current, ref), "disarmed");
      else goal.commit(resumeGoal(current, ref, goal.activation()), "armed");
      return value(goal);
    }

    // complete | blocked: el dueño, o la ronda EXACTA del encargo actual.
    const authority = goal.authority();
    const enRonda =
      authority?.kind === "goal-round" &&
      current !== null &&
      authority.goalId === current.id &&
      authority.revision === current.revision &&
      authority.round === current.roundsStarted;
    if (authority?.kind !== "direct-human" && !enRonda) {
      throw new GoalToolError("complete and blocked require a direct human turn or the current goal round");
    }
    if (hasText(args.objective) || hasRoundCap(args.max_goal_rounds)) {
      throw new GoalToolError("objective and max_goal_rounds are valid only with action edit");
    }
    if (action === "complete" && hasText(args.blocked_reason)) {
      throw new GoalToolError("blocked_reason is valid only with action blocked");
    }
    const blockedReason = typeof args.blocked_reason === "string" ? args.blocked_reason : "";
    if (action === "blocked" && blockedReason.trim().length === 0) {
      throw new GoalToolError("blocked_reason is required with action blocked");
    }
    if (action === "blocked" && enRonda && current!.roundsStarted < BLOCKED_AFTER_ROUNDS) {
      throw new GoalToolError(
        `blocked requires at least ${BLOCKED_AFTER_ROUNDS} consecutive goal rounds; current round is ${current!.roundsStarted}`,
      );
    }
    const next =
      action === "complete"
        ? completeGoal(current, ref)
        : blockGoal(current, ref, { code: "model-reported", message: blockedReason });
    goal.commit(next, "disarmed");
    const out = value(goal);
    // El `deferContext` de DeepSeek: en una ronda, el cierre al dueño antes de acabar.
    if (enRonda) out.notice = action === "complete" ? goalWrapup(next.objective) : goalWrapup(next.objective, blockedReason);
    return out;
  });
}
