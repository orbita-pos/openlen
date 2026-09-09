// ─────────────────────────────────────────────────────────────────────────────
// EL VEREDICTO DEL OBJETIVO — y quién lo da por TERMINADO.
//
// 🔴 SIN IMPORTS, Y ES EL PUNTO. Esta regla la necesitan dos lados:
//
//   · el SERVIDOR (`app/api/agent/route.ts`), que borra `settings.objetivo` de
//     la base cuando el objetivo acabó;
//   · el CLIENTE (`chat-panel.tsx`), que tiene que quitar la ficha del
//     compositor en ese mismo instante — si no, la ficha se queda en pantalla
//     anunciando un objetivo que el servidor ya borró, y el dueño ve un objetivo
//     activo que no existe hasta que recarga.
//
// `evaluar-condicion.ts` no sirve de casa común: importa `callModel`, que
// arrastra el servidor entero. Así que la regla vive aquí, sola y sin
// dependencias, y la importan los dos.
//
// Escribirla dos veces es el patrón que este repo lleva ocho veces pagando: la
// misma decisión en N sitios y una se queda atrás.
// ─────────────────────────────────────────────────────────────────────────────

/** Cómo puede acabar un turno que llevaba objetivo. */
export type VeredictoDeTurno = "cumplida" | "no_cumplida" | "imposible" | "sin_evaluador";

/**
 * ¿Este veredicto TERMINA el objetivo, o lo deja puesto?
 *
 * Termina con los dos que cierran la historia:
 *   · `cumplida`  — se logró.
 *   · `imposible` — no se puede tal y como está escrita; perseguirla más sólo
 *                   quemaría créditos del dueño.
 *
 * NO termina con los otros dos, y no son lo mismo:
 *   · `no_cumplida`   — «todavía». El turno se quedó sin vueltas y el objetivo
 *                       sigue siendo del dueño: borrarlo sería tirárselo por un
 *                       tope NUESTRO.
 *   · `sin_evaluador` — una avería nuestra. Perder el objetivo del dueño porque
 *                       nuestro juez falló sería castigarle por nuestro fallo.
 *
 * 🔴 LA LISTA ES CERRADA Y CAE HACIA CONSERVAR. Un veredicto que esta función no
 * conozca NO borra nada: perder el objetivo del dueño es el error caro; dejarlo
 * puesto de más sólo cuesta una lectura de base el turno siguiente.
 */
export function elObjetivoTermino(veredicto: VeredictoDeTurno): boolean {
  return veredicto === "cumplida" || veredicto === "imposible";
}
