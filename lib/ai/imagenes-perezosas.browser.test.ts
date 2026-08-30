// LO QUE LOS OJOS NO VEN PORQUE NADIE HACE SCROLL — con un navegador de verdad.
//
// La captura de verificación es `fullPage`, pero la ventana mide 1280x720 y
// nada baja por la página. Una `<img loading="lazy">` por debajo del pliegue no
// se pide JAMÁS: la foto sale con su hueco, y quien la mira reporta —con razón,
// dado lo que ve— que la página tiene recuadros vacíos.
//
// 🔴 MEDIDO el 2026-08-30 sobre la página real de un usuario (Terror a
// Medianoche): 4 imágenes, las 4 con `loading="lazy"`, **2 pintadas en la
// foto**. Cuatro segundos más de espera no cambiaban nada — no es lentitud, es
// que no se piden. Los ojos la declararon rota, `conHechos` forzó `broken`, y
// el Agente gastó un ciclo entero "arreglando" portadas que el visitante ve
// perfectamente. Ese ciclo se cobra: el turno costó 17 créditos.
//
// Es la MISMA familia que `origen-de-medida.browser.test.ts` (about:blank y
// localStorage) y que la doble inyección del runtime: los ojos juzgando una
// página que ningún visitante llega a tener delante. El documento guardado
// conserva su `lazy`, que para un visitante de verdad es lo correcto — lo que
// cambia es sólo la vista de usar y tirar.
//
// El brazo de control va DENTRO: se mide el MISMO documento por los dos
// caminos y se exige que el viejo falle. Sin eso, que el arreglo salga verde no
// demuestra nada.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";

// Dos imágenes: una arriba y otra empujada MUY abajo por un bloque alto. Las
// dos perezosas, como las escribe el modelo. Son data: URIs para que la prueba
// no dependa de la red — la pereza se comporta igual.
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const DOC = `<!doctype html><html><body style="margin:0">
<img id="arriba" loading="lazy" src="${PIXEL}" width="40" height="40">
<div style="height:4000px"></div>
<img id="abajo" loading="lazy" src="${PIXEL}" width="40" height="40">
</body></html>`;

const CONTAR = `Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0).length`;

async function pintadas(conArreglo: boolean): Promise<number> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    // La misma ventana que usan los ojos. Con una más alta el fallo se esconde.
    await page.setViewport({ width: 1280, height: 720 });
    await page.setContent(DOC, { waitUntil: "load", timeout: 20_000 });
    if (conArreglo) {
      await page.evaluate(() => {
        for (const img of Array.from(document.images)) img.loading = "eager";
      });
      await page
        .waitForFunction(() => Array.from(document.images).every((i) => i.complete), {
          timeout: 4_000,
          polling: 100,
        })
        .catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
    return (await page.evaluate(CONTAR)) as number;
  } finally {
    await browser.close();
  }
}

describe("las imágenes perezosas de debajo del pliegue", () => {
  it("🔴 SIN el arreglo, la de abajo no llega a la foto", async () => {
    expect(await pintadas(false)).toBe(1);
  }, 60_000);

  it("y con él se pintan las dos", async () => {
    expect(await pintadas(true)).toBe(2);
  }, 60_000);
});
