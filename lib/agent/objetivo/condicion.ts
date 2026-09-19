// ─────────────────────────────────────────────────────────────────────────────
// EL TOPE DE LA CONDICIÓN — una sola vez, y sin imports.
//
// 🔴 ESTABA ESCRITO DOS VECES: `CONDICION_MAX` en `evaluar-condicion.ts` y
// `MAX_CONDICION` en `lib/projects/settings-patch.ts`, este último con un
// comentario que decía «es el MISMO que el de la herramienta». Un comentario no
// es un compilador: dos números que "deben coincidir" coinciden hasta el día que
// alguien toca uno.
//
// El cliente iba a ser la TERCERA copia —el campo donde el dueño escribe su
// condición tiene que cortar donde corta el servidor— y ése fue el empujón para
// juntarlas. Vive aquí y sin dependencias porque `evaluar-condicion.ts` arrastra
// `callModel`, o sea el servidor entero, y desde un componente no se puede
// importar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuántos caracteres puede tener una condición de parada.
 *
 * El número sale de Claude Code (`wbt = 500` en `ProposeGoal`) y por su misma razón,
 * que su descripción deja escrita: «the user must be able to read the whole
 * condition in the approval dialog». No es un límite técnico, es cuánto texto
 * puede leer alguien antes de decidir.
 */
export const CONDICION_MAX = 500;
