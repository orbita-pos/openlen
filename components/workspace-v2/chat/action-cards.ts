import type { AgentAction } from "../agent-action-card";

/**
 * UNA TARJETA DE HERRAMIENTA, en la lista ordenada del turno: un `running`
 * nuevo se añade; un desenlace reemplaza la tarjeta `running` MÁS VIEJA de esa
 * herramienta, y si no hay ninguna, se añade.
 *
 * 🔴 Pieza 4 de Len 2.5: con herramientas en paralelo llegan VARIAS `running` a
 * la vez y sus desenlaces después, en el orden del modelo (el planificador las
 * abre y las confirma en ese orden). La regla de antes —un evento reemplazaba la
 * `running` de DETRÁS de la misma herramienta— pisaba la primera con la segunda,
 * y con herramientas distintas dejaba huérfana la de delante, que al recargar se
 * pinta como fallo (F3-T5). En serie hay como mucho una `running` y las dos
 * reglas dan lo mismo.
 *
 * Pura, porque la comparten el estado de React (`upsertAction`) y el acumulador
 * de `send()`, que tiene que dar la MISMA lista a `persistTurn`.
 */
export function upsertActionInto(actions: AgentAction[] | undefined, action: AgentAction): AgentAction[] {
  const next = actions ? [...actions] : [];
  if (action.status !== "running") {
    const i = next.findIndex((x) => x.tool === action.tool && x.status === "running");
    if (i >= 0) {
      next[i] = action;
      return next;
    }
  }
  next.push(action);
  return next;
}
