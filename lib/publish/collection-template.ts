// Lo que queda de la plantilla de catálogo: UNA constante.
//
// Aquí vivía `fillCollectionTemplate`, que rellenaba con los items del dueño una
// sección de catálogo DISEÑADA POR EL MODELO —tarjetas con su copy, su
// maquetación y su marca— en vez de inyectar una rejilla nuestra. Se va el
// 2026-08-29 con el horneado de colecciones: un catálogo es ahora un almacén de
// `lectura`, y sus filas las mete `lib/publish/bake-lectura.ts`.
//
// EL MARCADOR SOBREVIVE, y no por inercia: `strip-disabled-bands` lo usa para
// reconocer una banda que YA tiene items horneados de una publicación anterior y
// NO borrarla. Esa sección la escribió el modelo; borrarla al apagar el módulo
// le arrancaría al dueño parte de su página. Apagado significa «no la
// refresques», no «bórrala».

/** Marca una tarjeta de item dentro de una sección de catálogo. */
export const ITEM_ATTR = "data-ol-item";

/** Marca un campo dentro de una tarjeta (título, precio, imagen…). */
export const FIELD_ATTR = "data-ol-field";
