// CUÁNDO SE PUEDE VOLVER A PINTAR EL LIENZO — y, sobre todo, cuándo NO.
//
// POR QUÉ ES UN FICHERO Y NO CUATRO `if` DENTRO DE UN EFECTO. Porque cada uno
// de esos `if` protege trabajo del usuario que NO ESTÁ GUARDADO todavía, y
// equivocarse en uno no da un error: da una página que se queda como estaba y
// un usuario que no sabe por qué. Ya pasó en este mismo componente con
// `dropEnabled` — una condición mal puesta dentro de un componente, `tsc` en
// verde, 3.837 pruebas en verde, y la función nacida muerta. Aquí es una
// función con nombre y con pruebas: la próxima condición que alguien añada
// tendrá dónde colgarse.
//
// Re-derivar significa reconstruir el `srcDoc` del iframe desde el documento
// guardado. Eso RECARGA la página del lienzo, así que se lleva por delante
// cualquier cosa que viva sólo en el DOM vivo: un editor abierto a medias, la
// selección del inspector, y —desde el «Aplicar» explícito— los cambios que el
// usuario ha hecho y todavía no ha aplicado.

/** Lo que hay que saber para decidir. Todo booleano o número; ningún ref, para
 *  que la decisión se pueda probar sin montar el componente. */
export interface EstadoDelLienzo {
  /** Una inserción acaba de aterrizar en el DOM vivo y el padre pidió no
   *  recargar: el lienzo ya la enseña, y recargar la haría parpadear en blanco
   *  mientras una página pesada se vuelve a parsear. */
  readonly saltarPorInsercion: boolean;
  /** Ediciones hechas y sin aplicar. */
  readonly pendientes: number;
  /** Hay una sesión de edición abierta ahora mismo. */
  readonly editando: boolean;
  /** La había en la pasada anterior y ya no. */
  readonly veniaDeEditar: boolean;
}

/** Por qué NO se re-deriva, o `null` si se puede. El motivo se devuelve en vez
 *  de un booleano a propósito: quien llama tiene que apagar la bandera correcta
 *  y sólo ésa, y un `false` no dice cuál. */
export type MotivoParaNoRederivar =
  | "insercion"
  | "pendientes"
  | "editando"
  | "salio-de-editar"
  | null;

/**
 * EL ORDEN IMPORTA, y no es alfabético.
 *
 * 1. `insercion` va primero porque es una bandera de un solo uso: quien llama
 *    la apaga al consumirla, y si otra razón se colara antes, la bandera se
 *    quedaría puesta y taparía la SIGUIENTE recarga, que sí hacía falta.
 *
 * 2. `pendientes` va antes que `editando` porque no son lo mismo. Editar es una
 *    sesión que se abre y se cierra; los pendientes sobreviven a cerrarla y
 *    pueden quedarse ahí todo el rato que el usuario quiera. Si `editando`
 *    fuera primero, cerrar el modo edición con cambios sin aplicar dejaría pasar
 *    la recarga y se los borraría de la vista sin decir nada.
 *
 * 3. `salio-de-editar` es la última y consume su propia bandera: se salta UNA
 *    pasada para que un `doc` que ya está viejo no pise el DOM vivo mientras el
 *    guardado viaja.
 */
export function motivoParaNoRederivar(e: EstadoDelLienzo): MotivoParaNoRederivar {
  if (e.saltarPorInsercion) return "insercion";
  if (e.pendientes > 0) return "pendientes";
  if (e.editando) return "editando";
  if (e.veniaDeEditar) return "salio-de-editar";
  return null;
}
