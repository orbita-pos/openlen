// SE MIDE DONDE SE PUBLICA — con un navegador de verdad.
//
// Esta prueba nace de un fallo medido el 2026-08-26, en la primera página que
// se generó con el JavaScript del modelo ya libre. El brief pedía un carrito
// «que no se vacíe si recargo la página». DeepSeek escribió `localStorage`,
// que es la respuesta correcta. Y el log dijo:
//
//   [generate] rotura medida — el JavaScript de la página falla:
//   SecurityError: Failed to read the 'localStorage' property from 'Window'
//
// La página estaba bien. `page.setContent()` la cargaba en `about:blank`, cuyo
// origen es OPACO, y ahí `localStorage` lanza. Contamos eso como rotura,
// reescribimos la página entera, cobramos un crédito más y entregamos una
// segunda versión peor.
//
// El brazo de control va DENTRO de la prueba, no en un comentario: se mide el
// mismo documento por los dos caminos y se exige que el viejo falle. Sin eso,
// que el arreglo pase en verde no demuestra nada.
import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";

/** Toca las cuatro cosas que un origen opaco prohíbe, en el arranque. */
const PAGINA_CON_ALMACEN = `<!doctype html><html><head><meta charset="utf-8"><title>Carrito</title>
<style>body{font-family:Arial,sans-serif;margin:0}h1{font-size:40px;margin:24px}p{font-size:16px;margin:24px}</style>
</head><body>
  <h1>Grano Alto</h1>
  <p id="total">Carrito vacío</p>
  <script>
    var carrito = JSON.parse(localStorage.getItem("carrito") || "[]");
    carrito.push({ sku: "chiapas", precio: 180 });
    localStorage.setItem("carrito", JSON.stringify(carrito));
    sessionStorage.setItem("visto", "1");
    document.getElementById("total").textContent =
      carrito.length + " producto(s)";
  </script>
</body></html>`;

describe("una página se mide en el mismo origen en el que se publica", () => {
  it("localStorage NO es un error: la página con carrito persistente sale limpia", async () => {
    const medido = await renderVisualQualityViewports(PAGINA_CON_ALMACEN);

    expect(medido, "el render no se pudo hacer").not.toBeNull();
    expect(
      medido?.runtimeErrors ?? [],
      "la página usa localStorage como se le pidió y salió medida como rota",
    ).toEqual([]);
  }, 60_000);

  /**
   * EL BRAZO DE CONTROL. El mismo documento por el camino de antes
   * (`setContent` → `about:blank` → origen opaco) tiene que SEGUIR fallando.
   *
   * Si esto deja de fallar algún día, no es que Chromium se haya vuelto
   * generoso: es que la prueba de arriba dejó de medir lo que cree medir, y
   * habría que averiguar por qué antes de fiarse de ella.
   */
  it("y por el camino viejo —about:blank— el mismo documento SÍ revienta", async () => {
    const { default: puppeteer } = await import("puppeteer");
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      env: process.platform === "linux" ? { ...process.env, HOME: "/tmp" } : process.env,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      const gritos: string[] = [];
      page.on("pageerror", (e) => gritos.push(String(e instanceof Error ? e.message : e)));
      await page.setContent(PAGINA_CON_ALMACEN, { waitUntil: "load", timeout: 20_000 });

      expect(
        gritos.join(" | "),
        "about:blank dejó de ser un origen opaco — la prueba de arriba ya no demuestra nada",
      ).toMatch(/SecurityError|Access is denied/i);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
