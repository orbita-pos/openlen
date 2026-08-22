// lib/collections/catalog-block.ts — lo que el catálogo del usuario TIENE
// dentro, en la forma en que se le dice a un modelo que edita la página.
//
// POR QUÉ EXISTE. Los ítems no están en `data.html` a propósito: viven en la
// tabla `collectionItems` y las tarjetas se rellenan al PUBLICAR
// (`lib/publish/collection-template.ts`). El usuario ve cuarenta productos en
// el lienzo; el modelo ve las tarjetas de muestra que él mismo escribió, con
// otro texto. Sin este apéndice, «pon el menú en dos columnas» llega a un
// modelo que no sabe qué hay realmente en el catálogo.
//
// Es un APÉNDICE de sólo lectura, nunca se inyecta en el documento etiquetado:
// si entrara ahí, las ops apuntarían a nodos que no se persisten.

import type { ItemRow } from "@/lib/collections/store";
import { ITEM_ATTR, FIELD_ATTR } from "@/lib/publish/collection-template";

/** Cuántos ítems se enseñan. Un catálogo largo comería el contexto sin decir
 *  nada nuevo: con una docena el modelo ya sabe de qué van las tarjetas, qué
 *  campos están llenos y cuáles no. */
const MAX_ITEMS = 12;

/**
 * El bloque del catálogo, o `""` cuando no hay nada que contar.
 *
 * `""` es la respuesta correcta también cuando la colección existe pero está
 * vacía: decirle al modelo "hay una colección con 0 ítems" no cambia ninguna
 * decisión suya y gasta contexto.
 *
 * `html` decide QUÉ se le pide. Con tarjetas marcadas, que las respete al
 * re-estilizar. Sin ellas —una página anterior al contrato de plantilla, que
 * sólo lleva la banda vacía— que las ESCRIBA: es la vía por la que una página
 * vieja se moderniza sola en cuanto su dueño pide un cambio por el Chat.
 */
export function collectionCatalogBlock(
  items: readonly ItemRow[],
  html: string,
): string {
  if (items.length === 0) return "";
  const linea = (i: ItemRow) =>
    [
      `- ${i.title}`,
      i.priceDisplay ? `· ${i.priceDisplay}` : "",
      i.subtitle ? `· ${i.subtitle}` : "",
      i.badge ? `· [${i.badge}]` : "",
      i.imageUrl ? "· con foto" : "· sin foto",
    ]
      .filter(Boolean)
      .join(" ");
  const mostrados = items.slice(0, MAX_ITEMS).map(linea).join("\n");
  const resto =
    items.length > MAX_ITEMS ? `\n(y ${items.length - MAX_ITEMS} más)` : "";

  const instruccion = html.includes(ITEM_ATTR)
    ? `The cards in the document are a TEMPLATE, not final content: at publish the first one is repeated once per item above, so the sample text you see is replaced. Restyle them however the user asks — layout, colours, columns, typography — but keep \`${ITEM_ATTR}\` on each card and \`${FIELD_ATTR}\` on the elements carrying its text. Do NOT add or remove cards to match the item count, and do not hardcode these items' text into the page: publishing handles both.`
    : `This page predates the card template, so its catalog band renders EMPTY in the document above and OpenLen fills it with a generic grid of its own at publish. If the user asks for anything about the catalog's look, replace that empty band with real cards you design in this page's visual language: \`${ITEM_ATTR}\` on each card, and \`${FIELD_ATTR}="title|price|subtitle|description|badge|image|cta"\` on the elements carrying each piece of text. Write one card per item listed above. From then on your design is what publishes, and the generic grid is never used again.`;

  return `THIS PAGE'S CATALOG — ${items.length} item(s) the owner manages in OpenLen, kept in a database rather than in the document:
${mostrados}${resto}
${instruccion}

`;
}
