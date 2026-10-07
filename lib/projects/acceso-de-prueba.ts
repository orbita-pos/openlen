/**
 * `lib/projects/acceso.ts` PARA LAS PRUEBAS DE RUTAS que no tratan de los
 * miembros: quien pide es siempre el dueño, y la ruta sigue decidiendo con su
 * propia consulta «es del dueño» (que esas pruebas ya simulan). Así una prueba
 * escrita antes de compartir el proyecto prueba lo mismo que probaba:
 *
 *   vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
 *
 * Lo de los miembros se prueba contra Postgres (`miembros.pg.test.ts`) y en las
 * rutas que lo simulan a propósito (`ficheros/route.test.ts`).
 */
import type { AccesoAlProyecto, Permiso, RolDeMiembro, RolEnProyecto } from "./acceso";

export type { AccesoAlProyecto, Permiso, RolDeMiembro, RolEnProyecto };

export const ROLES_DE_MIEMBRO: readonly RolDeMiembro[] = ["editor", "lector"];

export function esRolDeMiembro(x: unknown): x is RolDeMiembro {
  return x === "editor" || x === "lector";
}

export function puede(rol: RolEnProyecto, permiso: Permiso): boolean {
  return permiso === "ver" || rol === "dueno" || rol === "editor";
}

export async function accesoAlProyecto(_projectId: string, userId: string): Promise<AccesoAlProyecto | null> {
  return userId ? { rol: "dueno", duenoId: userId } : null;
}

export async function exigirAcceso(projectId: string, userId: string, _permiso: Permiso): Promise<AccesoAlProyecto | Response> {
  return (await accesoAlProyecto(projectId, userId)) ?? new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
}
