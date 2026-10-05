// EL ENCARGO EN EL CHAT (pieza 8 de Len 2.5). La tarjeta del encargo enseña lo
// que el chat sabe del servidor: el último turno cerrado (al recargar) y los
// eventos `goal` y `done` del turno en vuelo. Como el modo plan, al servidor no
// viaja el estado sino la orden del dueño (crear, reanudar; quitar es una ruta
// aparte). Puro.

import {
  DEFAULT_MAX_GOAL_ROUNDS,
  goalRoundOf,
  goalRoundPrompt,
  parseGoalSnapshot,
  type GoalActivation,
  type GoalSnapshot,
} from "@/lib/agent/goal";
import type { StoredChatTurn } from "@/lib/projects/types";

export type GoalView = GoalSnapshot & { readonly activation: GoalActivation };

/** El encargo del último turno cerrado (`getChatMessages` lo pone ahí). */
export function lastGoal(turns: readonly StoredChatTurn[]): GoalView | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.enCurso) continue;
    return t.goal ? goalViewOf(t.goal, t.goal.activation) : null;
  }
  return null;
}

/** Lo que llega por el cable (`goal`, `done`), validado. */
export function goalViewOf(goal: unknown, activation: unknown): GoalView | null {
  const g = parseGoalSnapshot(goal);
  return g ? { ...g, activation: activation === "armed" ? "armed" : "disarmed" } : null;
}

export type GoalCard =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "running" | "paused" | "blocked";
      readonly objective: string;
      readonly round: number;
      readonly maxGoalRounds: number;
      /** El motivo del atasco, tal cual lo dio Len. */
      readonly reason: string | null;
      /** Atascado por el tope de rondas: el texto lo compone el chat. */
      readonly roundLimit: boolean;
      readonly canResume: boolean;
    };

/**
 * La tarjeta: en marcha (activo y armado), en pausa (en pausa, o activo y
 * desarmado — tras un reinicio, como en DeepSeek), atascado; oculta sin
 * encargo o completo (el cierre ya lo contó).
 */
export function goalCard(goal: GoalView | null): GoalCard {
  if (!goal || goal.phase === "complete") return { kind: "hidden" };
  const kind = goal.phase === "blocked" ? "blocked" : goal.phase === "active" && goal.activation === "armed" ? "running" : "paused";
  return {
    kind,
    objective: goal.objective,
    round: goal.roundsStarted,
    maxGoalRounds: goal.maxGoalRounds,
    reason: goal.blockedReason?.message ?? null,
    roundLimit: goal.blockedReason?.code === "round-limit",
    canResume: kind !== "running" && goal.roundsStarted < goal.maxGoalRounds,
  };
}

/** Se puede crear uno: sin encargo, o con uno ya completo (DeepSeek lo reemplaza). */
export function canCreateGoal(goal: GoalView | null): boolean {
  return goal === null || goal.phase === "complete";
}

/** La orden del dueño que viaja con el turno: crear, sólo con la ficha puesta y
 *  sin un encargo vivo (con uno vivo el servidor la ignoraría). */
export function goalOrder(chipOn: boolean, goal: GoalView | null): "create" | null {
  return chipOn && canCreateGoal(goal) ? "create" : null;
}

/**
 * El texto del turno que se pinta YA y que se guarda: con una orden del dueño,
 * el mensaje de la ronda que va a abrir —el mismo que compondrá el servidor,
 * que es el que lee el modelo en el historial—; sin ella, lo escrito.
 */
export function roundTextFor(order: "create" | "resume" | null, prompt: string, goal: GoalView | null): string {
  if (order === "create") return goalRoundPrompt({ objective: prompt.trim(), maxGoalRounds: DEFAULT_MAX_GOAL_ROUNDS }, 1);
  if (order === "resume" && goal) return goalRoundPrompt(goal, goal.roundsStarted + 1);
  return prompt;
}

/** Lo que sigue a un `done`: la ronda que el servidor ya abrió, o por qué paró. */
export function roundAfterDone(payload: unknown): { next: string } | { stopped: "credits" } | null {
  const round = (payload as { round?: { next?: unknown; stopped?: unknown } } | null)?.round;
  if (typeof round?.next === "string" && round.next) return { next: round.next };
  if (round?.stopped === "credits") return { stopped: "credits" };
  return null;
}

/** El turno de una ronda, por su mensaje (el de DeepSeek, que queda en la charla). */
export function roundOfTurn(userText: string): ReturnType<typeof goalRoundOf> {
  // Sin las correcciones del dueño (`↳`), como `splitCorrections` de chat-turn.tsx.
  return goalRoundOf(userText.split("\n↳ ")[0] ?? "");
}
