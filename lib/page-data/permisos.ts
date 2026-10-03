// Quién puede hacer qué. Puro, sin dependencias, sin excusas.
//
// Todo el sistema de datos libres se sostiene en esta tabla. Si `añadir`
// devolviera "todos" para `leer`, las reseñas de una página serían la lista de
// correos de cualquiera que sepa la URL — sin error, sin log, sin que nadie se
// entere. Por eso vive sola, en un fichero sin imports de runtime, con una
// prueba por celda y un brazo de control que la ha visto fallar.

import type { ModoVisitante, RoleGrants } from "./declaracion";

/** `cuenta` — alguien que entró con correo y contraseña en una página que
 *  declara `data-ol-accounts` (plans/page-accounts/design.md). `papel` es el
 *  que le dio el dueño, o `null` si no tiene ninguno (o la página ya no lo
 *  declara: un papel retirado no da nada). */
export type Actor =
  | { tipo: "dueño" }
  | { tipo: "visitante"; id: string }
  | { tipo: "cuenta"; id: string; papel: string | null };
export type Accion = "leer" | "crear" | "modificar" | "borrar";

/** Sobre qué documentos alcanza la acción. */
export type Alcance = "todos" | "propios" | "ninguno";

const AMPLITUD: Record<Alcance, number> = { ninguno: 0, propios: 1, todos: 2 };

/** `papeles` es lo que el almacén le da a cada papel de cuenta (su campo
 *  `papeles` en `data-ol-stores`). Sólo cuenta para `tipo: "cuenta"`. */
export function permite(
  modo: ModoVisitante,
  actor: Actor,
  accion: Accion,
  papeles: RoleGrants = {},
): Alcance {
  // El dueño del proyecto siempre alcanza todo lo suyo. No hay modo que se lo
  // quite: es su base, en su página, bajo su responsabilidad.
  if (actor.tipo === "dueño") return "todos";

  if (actor.tipo === "cuenta") {
    // Una cuenta es un visitante MÁS lo que su papel le da, y nunca menos:
    // entrar no quita nada. De los dos alcances, el más amplio. Un papel que el
    // almacén no nombra no da nada — y en `privado` eso es no alcanzar nada.
    const comoVisitante = permite(modo, { tipo: "visitante", id: actor.id }, accion);
    // `Object.hasOwn`: un papel llamado «constructor» no puede sacar nada del
    // prototipo.
    const delPapel =
      actor.papel !== null && Object.hasOwn(papeles, actor.papel)
        ? (papeles[actor.papel]![accion] ?? "ninguno")
        : "ninguno";
    return AMPLITUD[delPapel] > AMPLITUD[comoVisitante] ? delPapel : comoVisitante;
  }

  switch (modo) {
    case "propio":
      // Lee, crea, modifica y borra — SIEMPRE acotado a su documento.
      return "propios";
    case "lectura":
      return accion === "leer" ? "todos" : "ninguno";
    case "añadir":
      // La asimetría que define el modo: crear sí, leer no. Un visitante deja
      // sus datos en un formulario y no puede sacar los de los demás.
      return accion === "crear" ? "propios" : "ninguno";
    case "publico":
      // Cualquiera escribe y TODOS leen — reseñas, un muro. Es el único modo
      // donde un visitante ve lo que escribió otro, y por eso es un modo
      // aparte y no una bandera de `añadir`: el dueño lo declara sabiendo que
      // se ve. Ver el comentario de `ModoVisitante` en declaracion.ts.
      //
      // MODIFICAR y BORRAR siguen en "ninguno": público es escribir y leer, no
      // editar lo ajeno. Sin esto, cualquiera reescribiría la reseña de otro.
      return accion === "leer" ? "todos" : accion === "crear" ? "propios" : "ninguno";
    case "privado":
      // Las ventas de una caja: el visitante anónimo no alcanza NADA. Sólo las
      // cuentas a cuyo papel el almacén se lo da (arriba), y el dueño.
      return "ninguno";
  }
}
