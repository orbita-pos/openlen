/**
 * EL ENCARGO — pieza 8 de Len 2.5. Es el goal de DeepSeek (`deepseek-harness` @
 * 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt): un objetivo DURADERO por
 * conversación que la mantiene trabajando ronda tras ronda hasta que el modelo
 * lo marca completo con evidencia, se atasca de verdad o alguien lo para.
 *
 * De `packages/goal/goal/src/index.ts` salen las reglas y los errores del
 * dominio, literales; de `tool-goal/src/index.ts`, la política (`guidance`) y la
 * salida de las herramientas; de `goal-round-driver/src/prompt.ts`, el mensaje de
 * ronda, y de `tool-goal/src/wrapup.ts`, los dos cierres. Tres adaptaciones, y
 * nada más: «project» donde dice «workspace» (aquí el trabajo es el proyecto);
 * «After a service restart» donde dice «After session resume or fork» (Len no
 * tiene sesiones bifurcadas: lo que desarma un encargo es reiniciar el servicio);
 * y «(pages, files, or other artifacts)» donde dice «(files, commits, or other
 * artifacts)» (Len no tiene commits).
 *
 * Lo DURADERO (fase, revisión, rondas) viaja como la foto del modo plan: en la
 * transcripción de cada fila, y se pliega de la última. La ACTIVACIÓN es del
 * proceso y no se guarda (`goal-activation.ts`). Puro: lo importan las
 * herramientas, la ruta y el chat.
 */

export type GoalPhase = "active" | "paused" | "blocked" | "complete";
/** Si este proceso puede seguir solo con el encargo. Nunca se guarda. */
export type GoalActivation = "armed" | "disarmed";

export interface GoalBlockReason {
  readonly code: string;
  readonly message: string;
}

/** La foto duradera del encargo. `roundsStarted` lo deriva DeepSeek de las
 *  rondas admitidas en la sesión; aquí va en la foto, que es nuestra sesión. */
export interface GoalSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly objective: string;
  readonly phase: GoalPhase;
  /** Sólo mientras `phase` es `blocked`. */
  readonly blockedReason?: GoalBlockReason;
  readonly maxGoalRounds: number;
  readonly roundsStarted: number;
}

export interface GoalRef {
  readonly id: string;
  readonly revision: number;
}

/** El tope de rondas por defecto de DeepSeek (`defaultMaxGoalRounds`). */
export const DEFAULT_MAX_GOAL_ROUNDS = 256;
/** Las rondas seguidas antes de poder decir «atascado» (`blockedAfterConsecutiveRounds`). */
export const BLOCKED_AFTER_ROUNDS = 3;

/** Un fallo del dominio, con el texto y el código de DeepSeek. */
export class GoalError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GoalError";
  }
}

function resolveMaxGoalRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new GoalError("maxGoalRounds must be a positive safe integer", "GOAL_INVALID_MAX_ROUNDS");
  }
  return value;
}

function resolveObjective(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GoalError("goal objective must be a non-empty string", "GOAL_INVALID_OBJECTIVE");
  }
  return value.trim();
}

function expectCurrent(current: GoalSnapshot | null, ref: GoalRef): GoalSnapshot {
  if (current === null) throw new GoalError("no current goal", "GOAL_NOT_FOUND");
  if (ref.id !== current.id || ref.revision !== current.revision) {
    throw new GoalError(
      `stale goal ref "${ref.id}" revision ${ref.revision}; current is "${current.id}" revision ${current.revision}`,
      "GOAL_STALE_REVISION",
    );
  }
  return current;
}

function transitionError(current: GoalSnapshot, operation: string, allowed: readonly GoalPhase[]): GoalError {
  return new GoalError(
    `cannot ${operation} goal "${current.id}" from phase "${current.phase}"; expected ${allowed.join(" or ")}`,
    "GOAL_INVALID_TRANSITION",
  );
}

/** La fase nueva, con la revisión siguiente y sin motivo de bloqueo. */
function withPhase(current: GoalSnapshot, phase: GoalPhase): GoalSnapshot {
  const { blockedReason: _motivo, ...rest } = current;
  return { ...rest, revision: current.revision + 1, phase };
}

/** Crear: uno completo se puede reemplazar; cualquier otro, no. */
export function createGoal(
  current: GoalSnapshot | null,
  request: { objective: unknown; maxGoalRounds?: unknown },
  newId: string,
): GoalSnapshot {
  const objective = resolveObjective(request.objective);
  const maxGoalRounds = resolveMaxGoalRounds(request.maxGoalRounds ?? DEFAULT_MAX_GOAL_ROUNDS);
  if (current !== null && current.phase !== "complete") {
    throw new GoalError(`goal "${current.id}" already exists with phase "${current.phase}"`, "GOAL_ALREADY_EXISTS");
  }
  return { id: newId, revision: 1, objective, phase: "active", maxGoalRounds, roundsStarted: 0 };
}

/** Cambiar el objetivo o el tope sin tocar la fase. */
export function editGoal(
  current: GoalSnapshot | null,
  ref: GoalRef,
  request: { objective?: unknown; maxGoalRounds?: unknown },
): GoalSnapshot {
  const goal = expectCurrent(current, ref);
  if (request.objective === undefined && request.maxGoalRounds === undefined) {
    throw new GoalError("goal edit requires objective and/or maxGoalRounds", "GOAL_INVALID_EDIT");
  }
  return {
    ...goal,
    revision: goal.revision + 1,
    ...(request.objective === undefined ? {} : { objective: resolveObjective(request.objective) }),
    ...(request.maxGoalRounds === undefined ? {} : { maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds) }),
  };
}

export function pauseGoal(current: GoalSnapshot | null, ref: GoalRef): GoalSnapshot {
  const goal = expectCurrent(current, ref);
  if (goal.phase !== "active") throw transitionError(goal, "pause", ["active"]);
  return withPhase(goal, "paused");
}

/** Reanudar uno parado, o rearmar uno activo tras un reinicio, si le quedan rondas. */
export function resumeGoal(current: GoalSnapshot | null, ref: GoalRef, activation: GoalActivation): GoalSnapshot {
  const goal = expectCurrent(current, ref);
  const resumable: readonly GoalPhase[] = ["active", "paused", "blocked"];
  if (!resumable.includes(goal.phase)) throw transitionError(goal, "resume", resumable);
  if (goal.phase === "active" && activation === "armed") {
    throw new GoalError(`goal "${goal.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");
  }
  if (goal.roundsStarted >= goal.maxGoalRounds) {
    throw new GoalError(
      `goal "${goal.id}" exhausted ${goal.maxGoalRounds} goal rounds; increase maxGoalRounds before resuming`,
      "GOAL_INVALID_TRANSITION",
    );
  }
  return withPhase(goal, "active");
}

export function completeGoal(current: GoalSnapshot | null, ref: GoalRef): GoalSnapshot {
  const goal = expectCurrent(current, ref);
  const allowed: readonly GoalPhase[] = ["active", "paused", "blocked"];
  if (!allowed.includes(goal.phase)) throw transitionError(goal, "complete", allowed);
  return withPhase(goal, "complete");
}

export function blockGoal(current: GoalSnapshot | null, ref: GoalRef, reason: GoalBlockReason): GoalSnapshot {
  const goal = expectCurrent(current, ref);
  if (goal.phase !== "active") throw transitionError(goal, "block", ["active"]);
  if (
    typeof reason?.code !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(reason.code) ||
    typeof reason.message !== "string" ||
    reason.message.trim().length === 0
  ) {
    throw new GoalError(
      "goal block reason requires a lower-kebab-case code and a non-empty message",
      "GOAL_INVALID_BLOCK_REASON",
    );
  }
  return { ...withPhase(goal, "blocked"), blockedReason: { code: reason.code, message: reason.message } };
}

/** Una ronda admitida: cuenta, pero no es una mutación (la revisión no cambia). */
export function startRound(goal: GoalSnapshot): GoalSnapshot {
  return { ...goal, roundsStarted: goal.roundsStarted + 1 };
}

/**
 * EL ENCARGO AL EMPEZAR EL TURNO, plegado de la conversación como el modo plan:
 * la foto de la última fila CON transcripción. Una fila caída (sin
 * transcripción) no lo borra; una sin `goal` (o con `goal: null`, quitado) sí.
 */
export function goalFromRows(
  rows: readonly { readonly transcript: { readonly goal?: GoalSnapshot | null } | null }[],
): GoalSnapshot | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rows[i]!.transcript;
    if (t) return t.goal ?? null;
  }
  return null;
}

/** La sección `tool:goal` de DeepSeek (`guidance`), con el umbral de 3 y el reinicio. */
export const GOAL_GUIDANCE =
  "create_goal may infer goal intent from a direct human request in any language. " +
  "After a service restart, an active goal is disarmed: when " +
  "a human asks to continue or resume in any wording or language, use update_goal action " +
  "resume to rearm it. Mark complete only when the objective is actually achieved. Mark " +
  `blocked only after the same blocking condition persists for at least ${BLOCKED_AFTER_ROUNDS} ` +
  "consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, " +
  "or useful remaining work is not blocked.";

/** El mensaje de una ronda (`renderGoalRoundPrompt`), con «project». Queda en la conversación. */
export function goalRoundPrompt(goal: Pick<GoalSnapshot, "objective" | "maxGoalRounds">, round: number): string {
  return (
    "<goal_round>\n" +
    `Objective: ${JSON.stringify(goal.objective)}\n` +
    `Round: ${round}/${goal.maxGoalRounds}\n\n` +
    "Continue working toward the objective in this same session. Treat the current project, " +
    "tool results, and durable session state as authoritative; inspect them instead of assuming " +
    "earlier narration is still current. Make concrete progress and verify the result. Before " +
    "claiming completion, gather evidence that the whole objective is achieved, read the current " +
    "goal, and mark it complete. If work remains, leave the goal active for the next round. Follow " +
    "the configured goal-tool policy before reporting a blocker.\n" +
    "</goal_round>"
  );
}

const ROUND_PROMPT = /^<goal_round>\nObjective: (".*")\nRound: (\d+)\/(\d+)\n\n[\s\S]*<\/goal_round>$/;

/** El mensaje de ronda que guardó una fila, leído de vuelta (para pintarla en el chat). */
export function goalRoundOf(text: string): { objective: string; round: number; maxGoalRounds: number } | null {
  const match = ROUND_PROMPT.exec(text);
  if (!match) return null;
  try {
    const objective = JSON.parse(match[1]!) as unknown;
    if (typeof objective !== "string") return null;
    return { objective, round: Number(match[2]), maxGoalRounds: Number(match[3]) };
  } catch {
    return null;
  }
}

const GROUNDING =
  "Report only what earlier rounds and tool results in this session actually establish; " +
  "when a detail is not in the session, say so instead of inventing it. ";

/** El cierre de una ronda que marcó completo o bloqueado (`renderWrapupContext`). */
export function goalWrapup(objective: string, blockedReason?: string): string {
  const heading = `Objective: ${JSON.stringify(objective)}\n`;
  return blockedReason === undefined
    ? "<goal_complete>\n" +
        heading +
        "The goal is marked complete and this autonomous run is ending. Write the closing " +
        "message to the user now: state the outcome, summarize what was done and how it was " +
        "verified, and point to the concrete results (pages, files, or other artifacts). " +
        GROUNDING +
        "Note anything the user should review or do next. Address the user directly. Do not " +
        "call any more tools in this run; further work waits for the user's next instruction.\n" +
        "</goal_complete>"
    : "<goal_blocked>\n" +
        heading +
        `Blocked: ${JSON.stringify(blockedReason)}\n` +
        "The goal is marked blocked and this autonomous run is ending. Write the closing " +
        "message to the user now: state what has been completed so far, describe the concrete " +
        "blocking condition and what you tried, and say exactly what you need from the user to " +
        "continue. " +
        GROUNDING +
        "Address the user directly. Do not call any more tools in this run; further work " +
        "waits for the user's next instruction.\n" +
        "</goal_blocked>";
}

/** La salida de las tres herramientas (`goalValue` de DeepSeek). */
export function goalValue(goal: GoalSnapshot | null, activation: GoalActivation): Record<string, unknown> {
  if (goal === null) return { goal: null };
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...(goal.blockedReason === undefined
        ? {}
        : { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } }),
    },
    activation,
  };
}
