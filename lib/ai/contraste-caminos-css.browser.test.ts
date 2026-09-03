// CADA CAMINO POR EL QUE EL CSS PUEDE PINTAR UN FONDO ERA UN PUNTO CIEGO NUEVO.
//
// Van cinco arreglos con la misma causa —19/08, 23/08, 30/08 y dos el 02/09—,
// cada uno tapando UN camino. Estos son los cinco que quedaban, y no son
// teóricos: MEDIDOS el 2026-09-02 contra el medidor de entonces, los cinco
// fallaban. Cuatro se callaban ante texto invisible; tres inventaban hallazgos
// sobre texto perfectamente legible.
//
// Leer el píxel no arregla un camino: quita la categoría entera, porque
// Chromium ya compuso todos —incluidos los que todavía no existen—.
//
// Cada documento lleva DOS textos: uno que de verdad se lee y otro que de
// verdad no. Las dos aserciones son el brazo de control una de la otra: sin la
// primera, un medidor ciego pasaría; sin la segunda, uno que marcara todo.
import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "./visual-quality-renderer";

async function veredicto(html: string): Promise<{ apagado: boolean; legible: boolean; malos: unknown }> {
  const medido = await renderVisualQualityViewports(html);
  const malos = medido?.unreadableText ?? [];
  return {
    apagado: malos.some((m) => (m.texto ?? "").includes("APAGADO")),
    legible: malos.some((m) => (m.texto ?? "").includes("LEGIBLE")),
    malos: malos.map((m) => ({ t: m.texto, c: m.contrast, bg: m.background })),
  };
}

// El panel es BLANCO, pero `multiply` sobre negro lo pinta NEGRO. Antes: el
// medidor inventaba «1,16:1 sobre #ffffff» en el texto claro Y no veía el
// oscuro. El único de los cinco que fallaba en las dos direcciones a la vez.
const MEZCLA = `<!doctype html><html><head><style>
  body{margin:0;background:#000;font:16px/1.4 system-ui}
  .panel{background:#ffffff;mix-blend-mode:multiply;padding:40px}
</style></head><body>
  <div class="panel">
    <p style="color:#111111">APAGADO negro sobre lo que se pinta negro</p>
    <p style="color:#eeeeee">LEGIBLE claro sobre lo que se pinta negro</p>
  </div>
</body></html>`;

// El ancestro apaga TODO lo que hay dentro: fondo y texto acaban negros. Antes:
// mudo, cero hallazgos.
const FILTRO = `<!doctype html><html><head><style>
  body{margin:0;background:#fff;font:16px/1.4 system-ui}
  .apagador{filter:brightness(0);background:#ffffff;padding:40px}
</style></head><body>
  <div class="apagador"><p style="color:#111111">APAGADO por el filtro del ancestro</p></div>
  <p style="color:#111111;background:#ffffff;padding:20px">LEGIBLE fuera del filtro</p>
</body></html>`;

// El panel NO tiene color propio: oscurece lo que tiene detrás. Antes: inventaba
// un 1,00:1 sobre el texto blanco legible, y ESE INVENTO se comía por
// deduplicación al párrafo blanco-sobre-blanco de verdad del mismo documento —
// exactamente la avería que documenta el commit b2b99dae, repitiéndose viva.
const TRASLUZ = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  .velo{backdrop-filter:brightness(0.08);padding:40px}
</style></head><body>
  <div class="velo"><p style="color:#ffffff">LEGIBLE blanco sobre el fondo que el filtro oscurece</p></div>
  <p style="color:#ffffff;background:#ffffff;padding:20px">APAGADO blanco sobre blanco de verdad</p>
</body></html>`;

// Quien pinta el fondo oscuro es un ::before, que no es un elemento: no sale ni
// en el paseo por ancestros ni en `elementsFromPoint`. Antes: veía el real pero
// inventaba otro sobre el titular legible.
const PSEUDO = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  .seccion{position:relative;padding:60px}
  .seccion::before{content:"";position:absolute;inset:0;background:#0b1220}
  .seccion > *{position:relative}
</style></head><body>
  <section class="seccion"><h1 style="color:#ffffff;margin:0">LEGIBLE blanco sobre el pseudo oscuro</h1></section>
  <p style="color:#ffffff;background:#ffffff;padding:20px">APAGADO blanco sobre blanco de verdad</p>
</body></html>`;

// El panel dice #111111 y se pinta #c3c3c3, porque su ancestro está al 0,25.
// Antes: mudo.
const OPACIDAD = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  .desvanecido{opacity:0.25}
  .panel{background:#111111;padding:40px}
</style></head><body>
  <div class="desvanecido"><div class="panel"><p style="color:#ffffff">APAGADO blanco sobre lo que se pinta gris claro</p></div></div>
  <p style="color:#111111;background:#ffffff;padding:20px">LEGIBLE negro sobre blanco</p>
</body></html>`;

describe.each([
  ["mix-blend-mode", MEZCLA],
  ["filter en un ancestro", FILTRO],
  ["backdrop-filter", TRASLUZ],
  ["un pseudo-elemento que pinta el fondo", PSEUDO],
  ["una cadena de opacity", OPACIDAD],
])("%s", (_nombre, html) => {
  it("ve el texto que de verdad está apagado", async () => {
    const r = await veredicto(html);
    expect(r.apagado, `no lo vio — salió: ${JSON.stringify(r.malos)}`).toBe(true);
  }, 60_000);

  it("y NO inventa un hallazgo sobre el que sí se lee", async () => {
    const r = await veredicto(html);
    expect(r.legible, `inventado — salió: ${JSON.stringify(r.malos)}`).toBe(false);
  }, 60_000);
});

// ─── EL INVARIANTE DEL SCROLL ───────────────────────────────────────────────
//
// La captura de sondeo lleva `captureBeyondViewport`, así que sus coordenadas
// son las del DOCUMENTO. Los paseos por CSS, en cambio, scrollean para que
// `elementsFromPoint` responda. Si la captura se tomara con la página
// scrolleada, cada píxel vendría de otra altura y el fondo saldría de otro
// sitio — con una confianza total, que es lo peor.
//
// Es el mismo modo de fallo que mordió el 23/08 («el reloj cae en y=1657 con
// una ventana de 900, así que la pila volvía VACÍA»), movido del eje de
// `elementsFromPoint` al de la captura.
const HONDO = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  .relleno{height:1500px;background:#ffffff}
</style></head><body>
  <div class="relleno"></div>
  <p style="color:#101010;background:#101010;padding:20px">APAGADO muy por debajo del pliegue</p>
  <p style="color:#101010;background:#ffffff;padding:20px">LEGIBLE a la misma altura</p>
</body></html>`;

describe("el píxel se lee a la altura correcta", () => {
  it("ve el texto apagado a 1.500 px de profundidad, con su fondo exacto", async () => {
    const medido = await renderVisualQualityViewports(HONDO);
    const malos = medido?.unreadableText ?? [];
    const hallazgo = malos.find((m) => (m.texto ?? "").includes("APAGADO"));
    expect(hallazgo, `no lo vio — salió: ${JSON.stringify(malos)}`).toBeTruthy();
    // El fondo EXACTO es lo que prueba que el píxel vino de la altura correcta:
    // un desfase de scroll lo habría leído del relleno blanco de arriba.
    expect(hallazgo!.background).toBe("#101010");
  }, 60_000);

  it("y no marca el legible que hay a su lado", async () => {
    const medido = await renderVisualQualityViewports(HONDO);
    const malos = medido?.unreadableText ?? [];
    expect(malos.some((m) => (m.texto ?? "").includes("LEGIBLE"))).toBe(false);
  }, 60_000);
});
