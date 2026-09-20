// CÓMO SE DECLARA EN LA PÁGINA UNA FUNCIÓN QUE VIAJA POR `.toString()`.
//
// Los inyectores mandan su lógica al iframe serializando funciones:
//
//     `var isEditorNode = ${isEditorNode.toString()};`
//
// Y ahí hay una trampa que sólo aparece EN PRODUCCIÓN. El minificador del
// build renombra las funciones del módulo, pero el nombre de la IZQUIERDA es
// una cadena literal de la plantilla, así que no se renombra con ellas. Lo que
// acaba en la página es esto:
//
//     var isEditorNode = function f$(a){…};
//     var editChildTags = function fY(a){ … f$(c) … };   ← f$ no existe aquí
//
// El nombre de una expresión de función con nombre sólo está ligado DENTRO de
// ella, así que `editChildTags` revienta con `ReferenceError: f$ is not
// defined` la primera vez que el elemento tiene hijos. En `postEdicion` esa
// llamada vive dentro del `try` que envuelve el `postMessage`: la edición no se
// manda y **no se entera nadie**. En `descriptorDe` no hay `try`, así que el
// manejador se corta después de haber movido el DOM — el lienzo cambia y lo
// guardado no.
//
// En `next dev` no pasa, porque no hay minificación. Medido en la caja el
// 2026-09-20, sobre el bundle de producción.
//
// LA SALIDA: declarar también el nombre REAL, y apuntar el largo a él.
//
//     var f$ = function f$(a){…};
//     var isEditorNode = f$;
//
// Así la llamada cruzada encuentra lo que busca, y el nombre largo —el que usa
// el resto del guion inyectado— sigue valiendo. Sin minificar los dos nombres
// coinciden y no se emite el alias, así que en dev la salida es la de siempre.
//
// ⚠️ Esto NO deroga la regla de autosuficiencia de `inline-edit-core.ts` y
// `drop-place-core.ts`. Sigue siendo mejor no llamar a un hermano exportado:
// esto es la red por debajo, no un permiso.
//
// ⚠️ El alias mete un nombre corto (`f$`, `f1`…) en el ámbito global de la
// página, que comparte con el JavaScript del modelo. Es el nombre que el
// minificador eligió DENTRO de este chunk, así que es único entre nuestras
// funciones; una colisión pediría que el modelo declarase justo ese nombre.

/** `var <nombre> = <fn>;` — con el alias del nombre minificado si hace falta. */
export function decl(nombre: string, fn: { name: string; toString(): string }): string {
  const real = fn.name;
  const src = fn.toString();
  if (!real || real === nombre) return `var ${nombre} = ${src};`;
  return `var ${real} = ${src};\nvar ${nombre} = ${real};`;
}
