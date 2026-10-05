/**
 * LA ACTIVACIÓN DEL ENCARGO — pieza 8 de Len 2.5. En DeepSeek es «process-local;
 * never persisted»: si el proceso puede seguir SOLO con el encargo. Aquí igual:
 * un mapa del proceso (proyecto → encargo armado), colgado de `globalThis` como
 * `direcciones.ts` para que las rutas lo compartan. Al arrancar está vacío, así
 * que tras un reinicio (un deploy) todo encargo queda desarmado hasta que el
 * dueño lo reanuda — la regla de DeepSeek tras reanudar una sesión.
 *
 * La clave es el proyecto: su charla en curso es la conversación del encargo.
 */
import type { GoalActivation } from "@/lib/agent/goal";

const CLAVE = Symbol.for("openlen.agente.encargos");
type Global = typeof globalThis & { [CLAVE]?: Map<string, string> };
const armados: Map<string, string> = (globalThis as Global)[CLAVE] ?? ((globalThis as Global)[CLAVE] = new Map());

export function armGoal(projectId: string, goalId: string): void {
  armados.set(projectId, goalId);
}

export function disarmGoal(projectId: string): void {
  armados.delete(projectId);
}

/** Armado sólo para ESE encargo: uno nuevo en el mismo proyecto empieza de cero. */
export function goalActivation(projectId: string, goalId: string | undefined): GoalActivation {
  return goalId !== undefined && armados.get(projectId) === goalId ? "armed" : "disarmed";
}

/** Para las pruebas. */
export function _resetGoalActivation(): void {
  armados.clear();
}
