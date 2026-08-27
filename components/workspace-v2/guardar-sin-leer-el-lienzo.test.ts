// NINGÚN CAMINO DE GUARDADO LEE EL LIENZO. Ésa es la propiedad, y de ella
// depende que el JavaScript del modelo pueda correr mientras se edita.
//
// Durante meses no pudo. El motivo era concreto: el editor guardaba clonando el
// documento vivo, así que lo que el script hubiera hecho —un filtro que escondió
// media rejilla, un modal abierto, un reloj en 24:30— se persistía como la
// página del usuario. Jesús generó una página con filtros y favoritos, la vio
// muerta en el taller y pensó que estaba rota (2026-08-26).
//
// Esta prueba llevó la cuenta mientras los cinco inyectores se migraban, y el
// número llegó a cero el 2026-08-27. Ahora es lo contrario de un contador: es el
// guardia de que nadie vuelva a colgar un camino que lea la pantalla. Uno solo
// bastaría para corromper la página — y sólo las que tienen JavaScript, o sea en
// silencio y de forma intermitente, que es la peor manera de romperse.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LEE = "openlen:html-changed";

/** Los inyectores que pueden guardar. TODOS a cero: mandan QUÉ cambió, y el
 *  servidor lo aplica contra el documento guardado. */
const INYECTORES: readonly string[] = [
  "use-inline-edit.ts",
  // El inspector fue el último y el más ancho: instalar una temática dispara un
  // re-entintado que recorre TODO el cuerpo midiendo el color computado de cada
  // elemento contra los fondos del mundo nuevo. Esa medida sólo la tiene el
  // navegador —el color computado no está en el HTML—, así que lo que se migró
  // no fue la medida sino lo que viaja: las dos pasadas devuelven los elementos
  // que tocaron y de cada uno van DOS ATRIBUTOS, no su subárbol.
  "use-element-inspect.ts",
  "use-image-replace.ts",
  // Los dos estructurales. Eran los que daban miedo —mueven, duplican, borran y
  // reemplazan secciones enteras— y lo que los resolvió fue no partirlos: un
  // movimiento viaja como UNA operación y el servidor resuelve las dos rutas
  // contra el mismo documento, así que no hay índice que ajustar a mano.
  "use-section-reorder.ts",
  "use-section-insert.ts",
];

function fuente(...partes: string[]): string {
  return readFileSync(path.join(process.cwd(), ...partes), "utf8");
}

describe("ningún camino de guardado lee el DOM vivo", () => {
  it.each(INYECTORES)("%s no manda el documento entero", (f) => {
    const src = fuente("components", "workspace-v2", f);
    // Se cuentan los ENVÍOS, no las menciones. El mensaje se construye SIEMPRE
    // dentro del script del iframe, que es JavaScript escrito entre comillas
    // simples — así que `type: '…'` con comilla simple es el envío, y la
    // comilla doble sólo aparece en los comentarios de contrato de arriba de
    // cada fichero. Contarlos todos daba 4 donde hay 1.
    const envios = (src.match(new RegExp(`type: '${LEE}'`, "g")) ?? []).length;
    expect(
      envios,
      `${f} añadió un camino que lee el lienzo — eso vuelve a matar el ` +
        `JavaScript del modelo en el editor, y sólo en las páginas que lo tienen`,
    ).toBe(0);
  });

  /**
   * Y TAMPOCO HAY QUIEN LO RECIBA.
   *
   * El emisor y el receptor son dos mitades de la misma puerta. Dejar el
   * receptor de pie mientras no hay emisores es dejar la puerta puesta: el día
   * que alguien cuelgue un emisor «temporal», el guardado por foto del DOM
   * vuelve a funcionar, nadie ve un error, y las páginas con JavaScript
   * empiezan a guardarse mal otra vez.
   */
  it("y el taller no tiene ya dónde recibirlo", () => {
    const src = fuente("app", "[locale]", "new", "page.tsx");
    expect(
      src.includes(`e.data.type === "${LEE}"`) || src.includes(`e.data.type !== "${LEE}"`),
      "volvió un receptor de openlen:html-changed en /new — ver el comentario " +
        "que dejó su hueco",
    ).toBe(false);
  });

  /**
   * LA PUERTA, ABIERTA. Mientras quedaba un solo camino leyendo el lienzo,
   * `preview-area.tsx` TENÍA que congelar el JavaScript del modelo en modo
   * edición. Ya no queda ninguno, así que la pausa sobra — y esta prueba
   * comprueba que sigue sin estar.
   *
   * Si alguien la vuelve a poner sin migrar nada, esto lo dice.
   */
  it("y el JavaScript del modelo ya no se pausa al editar", () => {
    const preview = fuente("components", "workspace-v2", "preview-area.tsx");
    expect(
      preview.includes("neutralizarScripts"),
      "volvió la pausa del JavaScript en el taller: si es por un fallo real de " +
        "guardado, el arreglo es la edición que falte, no volver a congelar la página",
    ).toBe(false);
  });
});
