/** Cuánto trabajo compra una página. El usuario elige un nivel; esta tabla es
 *  la única que decide qué significa, y por eso vive aparte de la UI y de la
 *  ruta: subir un nivel es editar tres números aquí, no seis archivos.
 *
 *  Lo que NO toca: el tope de dinero por página. Ese es la barandilla
 *  (`OPENLEN_FABLE_PAGE_CAP_MICROMXN`) y sigue siendo un límite duro. Un nivel
 *  alto compra ambición, no permiso para gastar de más: si se pasa, la sesión
 *  para con `budget` y queda en la bitácora. */
export type PageEffort = "low" | "medium" | "high";

export interface EffortProfile {
  /** Turnos de herramienta que tiene la sesión de diseño. */
  readonly sessionTurns: number;
  /** Operaciones aceptadas antes de cerrar la sesión. */
  readonly acceptedMutations: number;
  /** Ciclos de crítica -> reparación después de diseñar. */
  readonly reviewRounds: number;
  /** Turnos que tiene cada reparación para atender lo que el crítico marcó. */
  readonly repairTurns: number;
}

export const DEFAULT_PAGE_EFFORT: PageEffort = "low";

/** `low` es exactamente lo que corría antes de que el dial existiera: los
 *  números con los que se midieron las páginas buenas. Cambiarlo cambiaría
 *  el piso, no el techo. */
const PROFILES: Readonly<Record<PageEffort, EffortProfile>> = Object.freeze({
  low: Object.freeze({ sessionTurns: 4, acceptedMutations: 12, reviewRounds: 1, repairTurns: 1 }),
  medium: Object.freeze({ sessionTurns: 6, acceptedMutations: 18, reviewRounds: 2, repairTurns: 1 }),
  high: Object.freeze({ sessionTurns: 8, acceptedMutations: 24, reviewRounds: 3, repairTurns: 2 }),
});

/** Los techos que la sesión acepta, derivados de la tabla en vez de escritos
 *  a mano: añadir un nivel más caro no puede dejar un tope viejo mordiéndolo. */
export const SESSION_TURN_CEILING = Math.max(...Object.values(PROFILES).map((p) => p.sessionTurns));
export const ACCEPTED_MUTATION_CEILING = Math.max(...Object.values(PROFILES).map((p) => p.acceptedMutations));

export function isPageEffort(value: unknown): value is PageEffort {
  return value === "low" || value === "medium" || value === "high";
}

export function effortProfile(effort: PageEffort = DEFAULT_PAGE_EFFORT): EffortProfile {
  return PROFILES[effort];
}
