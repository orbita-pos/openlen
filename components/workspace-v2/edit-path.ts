// CÓMO SE NOMBRA UN ELEMENTO PARA EL SERVIDOR.
//
// El taller deja de guardar fotos del DOM: manda ediciones, y una edición tiene
// que decir SOBRE QUÉ elemento es. El iframe no puede usar `data-op-id` —lo
// estampa el motor Rust, que vive en el servidor— así que nombra el elemento
// por su posición, y el servidor resuelve esa posición contra el documento
// guardado con `resolveOpIdByPath`.
//
// No es nuevo: el gesto «elige un elemento» del Chat lleva desde F1 haciendo
// exactamente este viaje (use-section-select.ts, app/api/agent/route.ts:317).
// Lo que cambia es que ahora lo usan también los cinco inyectores de edición,
// así que la construcción de la ruta pasa a vivir en UN sitio en vez de
// copiarse en cada uno.
//
// Estas funciones se serializan con `.toString()` dentro de los scripts que se
// inyectan en el iframe (el patrón de `CORE_SRC` en use-inline-edit.ts), así
// que tienen que ser AUTOSUFICIENTES: nada de closures, nada de imports, nada
// de sintaxis que el navegador no entienda. A cambio son TypeScript de verdad y
// se pueden probar sin navegador.

/**
 * La ruta posicional del elemento hasta `<body>` (excluido).
 *
 * `section:nth-of-type(3) > div:nth-of-type(2) > h1:nth-of-type(1)`
 *
 * `:nth-of-type` es por etiqueta, y eso importa: los `<style>` y `<script>` que
 * el propio editor inyecta al final del `<body>` son de otro tipo, así que no
 * desplazan la cuenta de nadie.
 */
export function buildEditPath(el: Element): string {
  const segs: string[] = [];
  let cur: Element | null = el;
  while (
    cur &&
    cur.tagName !== "BODY" &&
    cur.tagName !== "HTML" &&
    cur.parentElement
  ) {
    const tag = cur.tagName.toLowerCase();
    let nth = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) nth += 1;
      sib = sib.previousElementSibling;
    }
    segs.unshift(tag + ":nth-of-type(" + nth + ")");
    cur = cur.parentElement;
  }
  return segs.join(" > ");
}

/**
 * Las etiquetas de los hijos directos, en orden. LA FIRMA.
 *
 * La ruta de arriba es posicional, y ahí está su punto débil: si el JavaScript
 * del modelo insertó o quitó un hermano del mismo tipo, los índices del DOM
 * vivo dejan de casar con los del documento guardado y la ruta resolvería a un
 * VECINO. Una edición aterrizando callada en el elemento equivocado es la peor
 * forma de fallar: el usuario ve otra cosa cambiada y no sabe por qué.
 *
 * El servidor compara esta lista con la del elemento que resolvió y rechaza el
 * lote entero si no coincide (lib/page-engine/aplicar-ediciones.ts). Es barata,
 * sobrevive a lo que los scripts hacen de verdad —poner clases, cambiar
 * estilos, escribir texto— y cambia justo cuando la estructura se movió.
 *
 * SE SALTA LO NUESTRO. Los inyectores del editor cuelgan nodos propios dentro
 * de la página (asas de arrastre, botones de reemplazo, la superposición de
 * edición). Están en el DOM vivo y NO en el documento guardado, así que
 * contarlos haría que la firma nunca coincidiera y toda edición saldría
 * rechazada.
 */
export function editChildTags(el: Element): string[] {
  const out: string[] = [];
  let hijo = el.firstElementChild;
  while (hijo) {
    if (!isEditorNode(hijo)) out.push(hijo.tagName.toLowerCase());
    hijo = hijo.nextElementSibling;
  }
  return out;
}

/** ¿Este nodo lo puso el editor y no existe en el documento guardado? */
export function isEditorNode(el: Element): boolean {
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const n = attrs[i]!.name;
    if (n.indexOf("data-openlen-") === 0) return true;
  }
  return false;
}
