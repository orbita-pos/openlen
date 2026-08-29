// Quién puede hacer qué. Puro, sin dependencias, sin excusas.
//
// Todo el sistema de datos libres se sostiene en esta tabla. Si `añadir`
// devolviera "todos" para `leer`, las reseñas de una página serían la lista de
// correos de cualquiera que sepa la URL — sin error, sin log, sin que nadie se
// entere. Por eso vive sola, en un fichero sin imports de runtime, con una
// prueba por celda y un brazo de control que la ha visto fallar.

import type { ModoVisitante } from "./declaracion";

export type Actor = { tipo: "dueño" } | { tipo: "visitante"; id: string };
export type Accion = "leer" | "crear" | "modificar" | "borrar";

/** Sobre qué documentos alcanza la acción. */
export type Alcance = "todos" | "propios" | "ninguno";

export function permite(modo: ModoVisitante, actor: Actor, accion: Accion): Alcance {
  // El dueño del proyecto siempre alcanza todo lo suyo. No hay modo que se lo
  // quite: es su base, en su página, bajo su responsabilidad.
  if (actor.tipo === "dueño") return "todos";

  switch (modo) {
    case "propio":
      // Lee, crea, modifica y borra — SIEMPRE acotado a su documento.
      return "propios";
    case "lectura":
      return accion === "leer" ? "todos" : "ninguno";
    case "añadir":
      // La asimetría que define el modo: crear sí, leer no. Un visitante deja
      // una reseña y no puede sacar las de los demás.
      return accion === "crear" ? "propios" : "ninguno";
  }
}
