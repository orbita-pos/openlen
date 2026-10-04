// POR QUÉ NO SE ABRIÓ UN PROYECTO, en las tres cosas que el usuario puede hacer
// distinto (plans/new-chat/inventory.md, N31).
//
// Antes, `/new?project=<id>` con un 404 se quedaba en «Cargando proyecto…» para
// siempre: el taller tragaba cualquier `!res.ok` y nadie miraba el porqué. Un
// enlace a una página borrada dejaba a la persona atascada.
//
// La regla que importa: un fallo pasajero NO se dice como «no existe». Decirle a
// alguien que su página ya no está porque la red tosió es peor que el atasco.

/**
 * - `not_found`: no existe o es de otra cuenta. La API contesta 404 en los dos
 *   casos a propósito (no dice si existe algo que no es tuyo), y un 403 se dice
 *   igual. Salida: tus páginas.
 * - `signed_out`: la sesión se cerró. Salida: volver a entrar.
 * - `failed`: cualquier otra cosa (5xx, 429, la red). Salida: reintentar.
 */
export type ProjectLoadFailure = "not_found" | "signed_out" | "failed";

export function projectLoadFailureFromStatus(status: number): ProjectLoadFailure {
  if (status === 404 || status === 403) return "not_found";
  if (status === 401) return "signed_out";
  return "failed";
}
