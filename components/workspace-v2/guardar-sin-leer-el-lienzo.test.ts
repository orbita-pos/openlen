// EL GUARDIA DE LA FASE 4: QUÉ CAMINOS SIGUEN LEYENDO EL DOM VIVO.
//
// Todo esto existe para una cosa: que el JavaScript del modelo corra TAMBIÉN
// mientras se edita. Hoy no puede, y el motivo es concreto — el editor guarda
// clonando el documento vivo, así que lo que el script hubiera hecho (un filtro
// que escondió media rejilla, un modal abierto) se persistiría como la página
// del usuario.
//
// La condición para encenderlo no es «ya migré unos cuantos»: es que NINGÚN
// camino de guardado lea el lienzo. Uno solo que quede basta para corromper la
// página, y sólo en las páginas que tienen JavaScript — o sea, en silencio y de
// forma intermitente, que es la peor manera de romperse.
//
// Esta prueba lleva la cuenta. No prohíbe nada: FIJA el número que queda y
// enumera cuáles son. Cuando el número baje, hay que bajarlo aquí — y ese gesto
// es el que dice si ya se puede encender el JavaScript.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LEE = "openlen:html-changed";

/** Los inyectores que pueden guardar, y cuántas veces mandan el DOCUMENTO
 *  ENTERO. Cero = ese inyector ya sólo manda ediciones. */
const PENDIENTES: ReadonlyArray<[string, number]> = [
  // MIGRADO — sólo manda ediciones.
  ["use-inline-edit.ts", 0],
  // El inspector: de cinco caminos que quedaban, sobrevive UNO — `applyTematica`.
  // Y no por pereza: instalar una temática dispara un re-entintado que recorre
  // TODO el cuerpo midiendo el color computado de cada elemento contra los
  // fondos del mundo nuevo. Esa medida sólo la tiene el navegador —el color
  // computado no está en el HTML— y toca decenas de elementos a la vez.
  //
  // La salida está escrita en su comentario: que el re-entintado devuelva los
  // elementos que tocó y se mande una edición por cada uno. Son ediciones
  // normales; lo único que hay que subir es el techo de 100 por lote.
  ["use-element-inspect.ts", 1],
  // MIGRADO — el intercambio de asset y el redimensionado tocan UN elemento.
  ["use-image-replace.ts", 0],
  // MIGRADOS los dos ESTRUCTURALES. Eran los que daban miedo —mueven,
  // duplican, borran y reemplazan secciones enteras— y lo que los resolvió fue
  // no partirlos: un movimiento viaja como UNA operación y el servidor resuelve
  // las dos rutas contra el mismo documento, así que no hay índice que ajustar
  // a mano. Una inserción viaja con todos sus nodos juntos, que es como el DOM
  // los coloca.
  ["use-section-reorder.ts", 0],
  ["use-section-insert.ts", 0],
];

function fuente(fichero: string): string {
  return readFileSync(
    path.join(process.cwd(), "components", "workspace-v2", fichero),
    "utf8",
  );
}

describe("cuántos caminos siguen leyendo el DOM vivo para guardar", () => {
  it.each(PENDIENTES)("%s manda el documento entero %i vez/veces", (f, esperado) => {
    const src = fuente(f);
    // Se cuentan los ENVÍOS, no las menciones. El mensaje se construye SIEMPRE
    // dentro del script del iframe, que es JavaScript escrito entre comillas
    // simples — así que `type: '…'` con comilla simple es el envío, y la
    // comilla doble sólo aparece en los comentarios de contrato de arriba de
    // cada fichero. Contarlos todos daba 4 donde hay 1.
    const envios = (src.match(new RegExp(`type: '${LEE}'`, "g")) ?? []).length;
    expect(
      envios,
      envios > esperado
        ? `${f} añadió un camino que lee el lienzo — eso aleja el JavaScript libre en el editor`
        : `${f} ya no manda el documento entero: baja el número en esta lista`,
    ).toBe(esperado);
  });

  /**
   * LA PUERTA. Mientras esto sea mayor que cero, `preview-area.tsx` TIENE que
   * seguir llamando a `neutralizarScripts` en modo edición.
   *
   * Si alguien quita esa pausa antes de tiempo, esta prueba no lo impide —
   * ninguna prueba puede— pero deja escrito, con un número, cuánto falta y por
   * qué. La comprobación de que la pausa sigue puesta está debajo.
   */
  it("y mientras quede alguno, el taller SIGUE pausando el JavaScript", () => {
    const pendientes = PENDIENTES.reduce((n, [, c]) => n + c, 0);
    const preview = readFileSync(
      path.join(process.cwd(), "components", "workspace-v2", "preview-area.tsx"),
      "utf8",
    );
    const pausa = preview.includes("neutralizarScripts(html)");
    if (pendientes > 0) {
      expect(
        pausa,
        `quedan ${pendientes} caminos leyendo el lienzo y la pausa ya no está — ` +
          `una edición sobre una página con JavaScript persistirá lo que el ` +
          `script hizo, en silencio y sólo a veces`,
      ).toBe(true);
    } else {
      expect(
        pausa,
        "ningún camino lee ya el lienzo: la pausa sobra y el JavaScript puede correr editando",
      ).toBe(false);
    }
  });
});
