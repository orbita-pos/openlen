import { outerHtmlByOpId, resolveOpIdByPath } from "@/lib/html-ops";

// LA DIRECCIÓN DEL CULPABLE DEL DESBORDE, no su descripción.
//
// POR QUÉ EXISTE, medido en la página «Volcánica» el 2026-09-05: la sonda del
// navegador nombró al culpable —`span.font-display.text-xl`, con su ancho
// exacto— DOS turnos seguidos, y el Agente editó las dos veces un elemento
// vecino. No por no saber el arreglo: su propia herramienta le explica que la
// causa suele ser un ancho fijo en px, y él mismo lo dijo. Por no saber CUÁL.
// Sólo se arregló cuando el dueño mandó borrar el dibujo entero.
//
// `span.font-display.text-xl` es una DESCRIPCIÓN, y encima recortada a dos
// clases: en una página de Tailwind puede casar con varios nodos. El modelo
// edita por `data-op-id`, así que recibía algo que no podía usar y salía a
// buscarlo a ojo.
//
// EL PROBLEMA DE FONDO es que los dos documentos no son el mismo:
//   · los ojos miden el GUARDADO —el que ve el visitante—, y ése no tiene
//     op-ids: se le quitan al persistir y se re-etiqueta por turno;
//   · el modelo mira el ETIQUETADO, que vive en la sesión.
// Por eso la sonda sólo puede devolver una ruta posicional, y la traducción
// tiene que pasar por aquí.

/** Traduce la ruta del culpable a su `data-op-id`, o null si no se puede
 *  garantizar que sea el mismo nodo.
 *
 *  🔴 CORROBORA, y ésa es la razón de que esto sea una función y no dos líneas
 *  en la ruta. `resolveOpIdByPath` sobre un documento que ha divergido no
 *  falla: ACIERTA A OTRO NODO. Y mandar al modelo a editar un vecino en
 *  silencio es peor que no darle dirección ninguna — es exactamente el fallo
 *  que esto viene a cerrar, con más confianza encima.
 *
 *  Se exige que el nodo resuelto tenga la etiqueta que la ruta nombra y TODAS
 *  las clases que la sonda vio. Ante la duda, null: el aviso vuelve a ser el
 *  que ya había, que era útil aunque no fuera accionable. */
export function resolverCulpableOpId(
  taggedHtml: string,
  ruta: string,
  /** `tag#id.clase1.clase2` — lo que la sonda emite como `overflowCulprit`. */
  descripcion: string,
): string | null {
  if (!taggedHtml || !ruta) return null;
  try {
    const opId = resolveOpIdByPath(taggedHtml, ruta);
    if (!opId) return null;
    const nodo = outerHtmlByOpId(taggedHtml, opId);
    if (!nodo) return null;

    const etiqueta = /([a-z0-9-]+):nth-of-type\(\d+\)$/i.exec(ruta)?.[1];
    if (!etiqueta) return null;
    if (!new RegExp(`^<${etiqueta}[\\s>]`, "i").test(nodo.trim())) return null;

    // Las clases son lo que de verdad distingue en una página de Tailwind, así
    // que se piden TODAS las que la sonda nombró. Se busca sobre el `outerHTML`
    // entero y no sobre el atributo `class` a propósito: es una comprobación de
    // corroboración, no un parser, y un falso NEGATIVO aquí sólo cuesta perder
    // la dirección — un falso positivo costaría una edición en el nodo
    // equivocado.
    for (const clase of descripcion.split(".").slice(1)) {
      if (clase && !nodo.includes(clase)) return null;
    }
    return opId;
  } catch {
    return null;
  }
}
