/**
 * QUIÉN HIZO EL CAMBIO (compartir el proyecto). Las versiones —de la página y
 * de cada fichero— se guardan desde una docena de caminos (el editor, la
 * terminal, Len, restaurar, deshacer…) y todos trabajan con el id del DUEÑO.
 * En vez de pasar «quién» por cada uno, la ruta envuelve su handler en
 * `conAutorDeLaPeticion` (o su trabajo en `conAutor`) y quien guarda la
 * versión lo lee aquí.
 *
 * ⚠️ Con `run`, no con `enterWith`: en Node 22 lo marcado con `enterWith` se
 * filtra al que espera a la ruta (medido en `autor-del-cambio.test.ts`).
 *
 * Fuera de un `conAutor` (scripts, el conductor de un encargo, pruebas) no hay
 * autor: la versión queda como siempre, sin nombre.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

const contexto = new AsyncLocalStorage<{ readonly autorId: string }>();

export function conAutor<T>(autorId: string | null | undefined, trabajo: () => T): T {
  return autorId ? contexto.run({ autorId }, trabajo) : trabajo();
}

/** El id de quien pidió el cambio en curso, o `null`. */
export function autorDelCambio(): string | null {
  return contexto.getStore()?.autorId ?? null;
}

/**
 * Para una ruta: el mismo handler, con el usuario de la sesión como autor de
 * lo que guarde. `quien` lo resuelve la ruta (sesión o llave del móvil).
 */
/** El usuario de la sesión (Auth.js), para `conAutorDeLaPeticion`. */
export async function quienDeLaSesion(): Promise<string | null> {
  const { auth } = await import("@/auth");
  return (await auth())?.user?.id ?? null;
}

export function conAutorDeLaPeticion<A extends unknown[], R>(
  quien: (...args: A) => Promise<string | null>,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R>;
export function conAutorDeLaPeticion<A extends unknown[], R>(
  quien: () => Promise<string | null>,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R>;
export function conAutorDeLaPeticion<A extends unknown[], R>(
  quien: (...args: A) => Promise<string | null>,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => conAutor(await quien(...args), () => handler(...args));
}
