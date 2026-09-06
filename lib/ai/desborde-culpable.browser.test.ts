// A QUIÉN SEÑALA EL DETECTOR DE DESBORDE — y por qué señalaba al inocente.
//
// 🔴 MEDIDO el 2026-09-04, en el experimento de los dos sobres. Las CUATRO
// corridas de la tarea «arregla el móvil» salieron con «culpable: `th`» sobre
// una tabla que el modelo YA había puesto en `display:block; overflow-x:auto` —
// el patrón responsive correcto, la tabla scrollea dentro de sí misma y la
// página no se mueve. Le mandábamos al modelo a arreglar lo único que estaba
// bien.
//
// La causa: la comprobación miraba SÓLO el `overflow-x` del propio nodo, y como
// gana el elemento MÁS PROFUNDO, el ganador era siempre una celda de esa tabla.
// El comentario del código ya decía la intención correcta; le faltaba el paseo
// por ancestros.
//
// Y la otra mitad, que es la que de verdad se salía: 189px de scroll lateral
// que NADIE nombraba, porque venían de una dirección de correo de 57 caracteres
// sin puntos de corte. Eso no tiene caja — `getBoundingClientRect` no lo ve—,
// pero `scrollWidth` sí.
//
// ⚠️ ESTAS PRUEBAS TIENEN QUE SER DE NAVEGADOR. Las de
// visual-quality-renderer.test.ts mockean `page.evaluate`, así que NUNCA
// ejecutan la sonda: el fallo vivió ahí dentro con la suite en verde.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

const marco = (cuerpo: string, estilo = "") => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}${estilo}</style>
</head><body>${cuerpo}</body></html>`;

// La tabla ANCHA metida en una caja que scrollea: el arreglo correcto.
const TABLA_SCROLLABLE = marco(
  `<div class="marco"><table class="carta">
    <thead><tr><th>Platillo</th><th>Categoría</th><th>Descripción larga de verdad</th><th>Precio</th></tr></thead>
    <tbody><tr><td>Asado de boda</td><td>Principal</td><td>Cerdo en adobo de chile colorado</td><td>$210</td></tr></tbody>
  </table></div>`,
  `.marco{width:100%;padding:20px;box-sizing:border-box}
   table.carta{display:block;overflow-x:auto;width:100%;min-width:0;border-collapse:collapse}
   table.carta th,table.carta td{padding:14px 18px;white-space:nowrap}`,
);

// Una caja que de verdad MIDE de más, sin nada que la contenga.
const CAJA_ANCHA = marco(
  `<div class="marco"><section id="portada" style="width:1100px;background:#eee">se sale</section></div>`,
  `.marco{width:100%;padding:20px;box-sizing:border-box}`,
);

// La caja cabe; lo que se sale es el TEXTO.
const CORREO_LARGO = marco(
  `<div class="marco"><p id="contacto">Calle Tacuba 214 · reservaciones.cantinalabufa.zacatecas@correodelacantina.com.mx</p></div>`,
  `.marco{width:100%;padding:20px;box-sizing:border-box}`,
);

// LA CADENA HEREDADA: el ancho lo pone el <div>, el <p> sólo lo hereda. Los dos
// llegan igual de lejos, y el que se arregla es el de FUERA.
const CADENA_HEREDADA = marco(
  `<div class="marco"><div id="fija" style="width:600px;background:#eee"><p id="dentro">Un párrafo normal.</p></div></div>`,
  `.marco{width:100%;padding:20px;box-sizing:border-box}`,
);

// EL CASO `documentacion#3`, reducido: un nodo HONDO que se sale poco y uno
// SUPERFICIAL que se sale mucho. El más profundo llega a ~470; la tarjeta, a
// ~580. Nombrar al hondo es mandar a estrechar algo que ya cabía.
const HONDO_INOCENTE = marco(
  `<div class="marco"><section id="tarjeta" style="width:560px;background:#eee">
     <div style="padding-left:300px"><span id="hondo" style="display:inline-block;width:150px;background:#ccc">x</span></div>
   </section></div>`,
  `.marco{width:100%;padding:20px;box-sizing:border-box}`,
);

describe("a quién señala el desborde en móvil", () => {
  it("🔴 una tabla que YA scrollea por dentro no tiene culpables — ni ella ni sus celdas", async () => {
    const r = await renderVisualQualityViewports(TABLA_SCROLLABLE, {});
    expect(r, "el render falló: sin medida no hay prueba").toBeTruthy();
    // Lo que salía antes: `th`, `td`, `tr`, `thead`… todos hijos de la tabla.
    expect(r!.overflowCulprit ?? "").not.toMatch(/^(th|td|tr|thead|tbody)\b/);
  }, 60_000);

  it("CONTRA-PRUEBA: una caja que de verdad mide de más SÍ se señala", async () => {
    const r = await renderVisualQualityViewports(CAJA_ANCHA, {});
    expect(r).toBeTruthy();
    expect(r!.mobileOverflow, "una caja de 1100px a 390px se sale").toBe(true);
    expect(r!.overflowCulprit).toContain("portada");
    expect(r!.overflowCulpritKind).toBe("caja");
  }, 60_000);

  it("el desborde de TINTA se nombra, en vez de dejar el aviso sin culpable", async () => {
    const r = await renderVisualQualityViewports(CORREO_LARGO, {});
    expect(r).toBeTruthy();
    expect(r!.mobileOverflow, "una cadena de 57 caracteres sin cortes se sale").toBe(true);
    // Lo que pasaba antes de nombrarlo: culpable vacío, y el modelo recibía el
    // aviso genérico que se midió que arregla el desborde 1 de 3 veces.
    //
    // 🔴 Y ESTA PRUEBA SUJETA EL DESEMPATE DE LA TINTA, que es el CONTRARIO al
    // de la caja: `.marco` y `p#contacto` declaran el mismo alcance —el
    // `scrollWidth` del texto sube por la cadena— y gana el de DENTRO, que es
    // el único donde `overflow-wrap` hace algo.
    expect(r!.overflowCulprit ?? "").not.toBe("");
    expect(r!.overflowCulprit).toContain("contacto");
    expect(r!.overflowCulpritKind).toBe("tinta");
  }, 60_000);

  it("🔴 el que llega MÁS LEJOS gana al más profundo — el hondo que se sale poco es inocente", async () => {
    const r = await renderVisualQualityViewports(HONDO_INOCENTE, {});
    expect(r).toBeTruthy();
    expect(r!.mobileOverflow).toBe(true);
    // Lo que salía antes del 2026-09-06: `span#hondo`, a ~470px, con la tarjeta
    // llegando a ~580. Es el caso de `documentacion#3` en pequeño.
    expect(r!.overflowCulprit).toContain("tarjeta");
    expect(r!.overflowCulprit ?? "").not.toContain("hondo");
  }, 60_000);

  it("🔴 a igual alcance gana el más SUPERFICIAL: el ancho lo pone el <div>, no el <p>", async () => {
    const r = await renderVisualQualityViewports(CADENA_HEREDADA, {});
    expect(r).toBeTruthy();
    expect(r!.mobileOverflow).toBe(true);
    // El <p> mide 600 porque su padre mide 600: en flujo normal el bloque hijo
    // hereda el ancho. Culparlo era culpar al síntoma.
    expect(r!.overflowCulprit).toContain("fija");
    expect(r!.overflowCulprit ?? "").not.toContain("dentro");
  }, 60_000);

  it("CONTRA-PRUEBA: una página que cabe no inventa culpable de ningún tipo", async () => {
    const r = await renderVisualQualityViewports(
      marco(`<div class="marco"><p>Cabe de sobra.</p></div>`, `.marco{width:100%;padding:20px;box-sizing:border-box}`),
      {},
    );
    expect(r).toBeTruthy();
    expect(r!.mobileOverflow).toBe(false);
    expect(r!.overflowCulprit ?? "").toBe("");
    expect(r!.overflowCulpritKind).toBeUndefined();
  }, 60_000);
});
