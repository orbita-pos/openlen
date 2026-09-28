// LO QUE ESTÁ FIJO EN LA VENTANA NO ES EL FONDO DEL TEXTO.
//
// 🔴 MEDIDO el 2026-09-26 en Len-Bench (control, `taqueria-menu-whatsapp` #2 y
// #3): el precio «$25», naranja #d94f1e sobre la tarjeta BLANCA —se lee a ~4:1—
// salía «#d94f1e sobre #d94f1e a 1.00:1». Lo que había debajo en la captura no
// era la tarjeta: era la barra de «Pedir por WhatsApp», `position:fixed` abajo
// y con fondo acento. La captura de sondeo se toma con el scroll a cero, y ahí
// Chromium pinta lo fijo en su sitio de la VENTANA, encima de lo que caiga en
// esa franja del documento. Len se lo creyó dos veces, razonó en voz alta en
// inglés delante del dueño, y acabó cambiando un precio que estaba bien. Y la
// barra fija de WhatsApp es de lo más común en las páginas de este producto.
//
// La doctrina de siempre en este fichero: la duda nunca se convierte en un
// hallazgo. Un punto tapado por algo fijo que NO contiene al texto no dice nada
// del fondo del texto; se descarta, y si no queda ninguno manda el respaldo por
// CSS, que ya salta lo que está por ENCIMA del texto.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

// La medida de contraste corre en el móvil (390×844). Una barra fija de 120 px
// abajo ocupa y 724–844 con el scroll a cero; lo que se quiere medir cae en
// y≈760, justo debajo de ella.
const conBarra = (debajo: string, barra = `<a style="display:block;color:#ffffff;padding:14px">Pedir por WhatsApp</a>`) => `<!doctype html><html><head><style>
  body{margin:0;background:#fffaf2;font:16px/1.4 system-ui}
  .barra{position:fixed;left:0;right:0;bottom:0;height:120px;background:#d94f1e}
</style></head><body>
<div style="height:740px"></div>
${debajo}
<div style="height:1200px"></div>
<div class="barra">${barra}</div>
</body></html>`;

describe("una barra fija abajo", () => {
  it("🔴 NO inventa «acento sobre acento» en el texto que la barra tapa en la captura", async () => {
    const html = conBarra(`<div style="background:#ffffff;padding:8px 18px"><span style="color:#d94f1e;font-size:22px">$25</span></div>`);
    const malos = (await renderVisualQualityViewports(html))?.unreadableText ?? [];
    expect(
      malos.find((m) => (m.texto ?? "").includes("$25")),
      `hallazgo inventado: ${JSON.stringify(malos)}`,
    ).toBeUndefined();
  }, 60_000);

  // BRAZO DE CONTROL: el texto que de verdad no se lee, en la MISMA franja que
  // tapa la barra, se sigue viendo — por el respaldo, ya que el píxel no sirve.
  it("y sigue viendo el texto ilegible de verdad que queda debajo de la barra", async () => {
    const html = conBarra(`<div style="background:#ffffff;padding:8px 18px"><p style="color:#f4f4f4;margin:0">Horario de cocina</p></div>`);
    const malos = (await renderVisualQualityViewports(html))?.unreadableText ?? [];
    expect(
      malos.some((m) => (m.texto ?? "").includes("Horario")),
      `no lo vio: ${JSON.stringify(malos)}`,
    ).toBe(true);
  }, 60_000);

  // BRAZO DE CONTROL: el texto DE la barra se mide contra la barra. Descartar
  // puntos tapados no puede cegar lo que está dentro de lo fijo.
  it("y sigue viendo el texto ilegible DENTRO de la barra fija", async () => {
    const html = conBarra("", `<span style="display:block;color:#da5020;padding:14px">Pedir por WhatsApp</span>`);
    const malos = (await renderVisualQualityViewports(html))?.unreadableText ?? [];
    expect(
      malos.some((m) => (m.texto ?? "").includes("Pedir")),
      `no lo vio: ${JSON.stringify(malos)}`,
    ).toBe(true);
  }, 60_000);
});
