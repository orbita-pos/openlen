// LO QUE LOS OJOS NO VEN PORQUE NADIE BAJA — la otra mitad del mismo agujero.
//
// Hermana directa de `imagenes-perezosas.browser.test.ts`, y existe porque
// aquélla tapó SÓLO su puerta. Allí eran `<img loading="lazy">` que no se piden
// nunca; aquí es el CONTENIDO que el modelo revela con `IntersectionObserver`
// al bajar. La captura de página entera no hace scroll, así que el observador
// no dispara y la sección se fotografía a `opacity: 0`.
//
// 🔴 MEDIDO el 2026-09-07 dentro del propio render, sobre `referencia-calida`
// (el primer caso del cohorte con imagen adjunta):
//
//     .service-card → 352x288, maquetada, en y=1391 … opacity: "0"
//
// Tres tarjetas de servicios con su texto en el DOM y su caja puesta, y la foto
// salió con el titular «Lo que hacemos» encima de un hueco. LA PÁGINA PUNTUÓ
// LIMPIA: ninguno de los nueve códigos del marcador puede verlo, y el medidor
// de contraste menos que ninguno —un texto invisible no tiene píxeles que
// puedan fallar—. `unreadable: 0` sobre una sección entera que no se ve.
//
// ALCANCE: 3 de las 17 páginas del cohorte (18%).
//
// Y LA FACTURA YA SE PAGÓ UNA VEZ por la puerta de al lado: 4 imágenes
// perezosas, 2 pintadas, los ojos declararon rota una página sana y el Agente
// gastó un ciclo entero «arreglándola» — 17 créditos.
//
// ⚠️ DE NAVEGADOR A LA FUERZA. `visual-quality-renderer.test.ts` mockea
// `page.evaluate`, así que nunca ejecuta el programa: el fallo puede vivir ahí
// dentro con la suite en verde. Y el brazo de control va DENTRO —se mide el
// MISMO documento por los dos caminos y se exige que el viejo falle—, porque
// que el arreglo salga verde no demuestra nada por sí solo.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";

import { DESPERTAR_LA_PAGINA } from "./despertar-la-pagina";

// Una sección empujada MUY abajo por un bloque alto, revelada al bajar
// exactamente como lo escribe el modelo: `style.opacity='0'` al arrancar y
// `'1'` cuando el observador la ve.
const PAGINA = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:16px system-ui}.alto{height:2400px;background:#f6f3ee}
.tarjeta{padding:24px;background:#fff;border:1px solid #ddd}</style></head><body>
<h1>Arriba del todo</h1>
<div class="alto">un bloque muy alto que empuja lo de abajo fuera de la ventana</div>
<section id="servicios">
  <div class="tarjeta reveal"><h3>Proyectos residenciales</h3><p>Diseño integral de viviendas.</p></div>
  <div class="tarjeta reveal"><h3>Asesoría de color</h3><p>Paletas que armonizan con la luz.</p></div>
</section>
<img id="perezosa" loading="lazy" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==">
<script>
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) e.target.style.opacity = '1'; });
  });
  document.querySelectorAll('.reveal').forEach(function (el) {
    el.style.opacity = '0';
    obs.observe(el);
  });
</script>
</body></html>`;

/** Cuántas `.reveal` quedan invisibles, medido en el navegador. */
async function invisiblesTras(despertar: boolean): Promise<{ invisibles: number; devuelto: unknown }> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setContent(PAGINA, { waitUntil: "load" });
    // El camino VIEJO: sólo las imágenes, que es lo único que había hasta hoy.
    // El NUEVO: recorrer la página como un visitante.
    const devuelto = despertar
      ? await page.evaluate(DESPERTAR_LA_PAGINA)
      : await page.evaluate(() => {
          for (const img of Array.from(document.images)) img.loading = "eager";
          return null;
        });
    await new Promise((r) => setTimeout(r, 200));
    const invisibles = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll(".reveal")).filter(
          (el) => getComputedStyle(el).opacity === "0",
        ).length,
    );
    return { invisibles, devuelto };
  } finally {
    await browser.close();
  }
}

describe("el contenido que se revela al bajar", () => {
  // 🔴 EL BRAZO DE CONTROL. Si esto pasara a verde, el arreglo de abajo no
  // estaría demostrando nada: querría decir que el fallo nunca existió.
  it("🔴 CONTROL: sin recorrer la página, las secciones quedan INVISIBLES", async () => {
    const { invisibles } = await invisiblesTras(false);
    expect(invisibles, "el fallo que este arreglo persigue ya no ocurre").toBe(2);
  }, 60_000);

  it("🔴 recorriéndola, se revelan — que es lo que ve un visitante", async () => {
    const { invisibles } = await invisiblesTras(true);
    expect(invisibles).toBe(0);
  }, 60_000);

  it("informa de cuántas despertó, para que se pueda medir sin abrir el navegador", async () => {
    const { devuelto } = await invisiblesTras(true);
    const r = devuelto as { pasos: number; despertados: number; altura: number };
    expect(r.despertados).toBe(2);
    expect(r.pasos).toBeGreaterThan(1);
    expect(r.altura).toBeGreaterThan(2400);
  }, 60_000);

  // La otra mitad, que ya estaba cubierta pero ahora vive en el mismo programa:
  // si alguien parte esto en dos otra vez, esta prueba lo dice.
  it("y sigue despertando las imágenes perezosas — es UN solo programa", async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(PAGINA, { waitUntil: "load" });
      await page.evaluate(DESPERTAR_LA_PAGINA);
      const lazy = await page.evaluate(
        () => (document.getElementById("perezosa") as HTMLImageElement).loading,
      );
      expect(lazy).toBe("eager");
    } finally {
      await browser.close();
    }
  }, 60_000);

  // 🔴 LO QUE NO DEBE HACER. Forzar `opacity: 1` nos dejaría ciegos AL REVÉS:
  // una sección que de verdad nace invisible pasaría por buena, y eso es peor
  // que el fallo que esto arregla. Sólo se baja por la página; lo que siga
  // oculto después, oculto se queda.
  it("🔴 CONTRA-PRUEBA: lo que está oculto por CSS sigue oculto — no se fuerza nada", async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(
        `<!doctype html><html><body><div class="alto" style="height:2000px"></div>
         <p id="fantasma" style="opacity:0">nadie debería ver esto</p></body></html>`,
        { waitUntil: "load" },
      );
      await page.evaluate(DESPERTAR_LA_PAGINA);
      const opacidad = await page.evaluate(
        () => getComputedStyle(document.getElementById("fantasma")!).opacity,
      );
      expect(opacidad).toBe("0");
    } finally {
      await browser.close();
    }
  }, 60_000);
});
