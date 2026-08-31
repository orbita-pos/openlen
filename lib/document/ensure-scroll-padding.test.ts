// EL ANCLA QUE ATERRIZABA DEBAJO DE LA BARRA — 2026-08-30.
//
// MEDIDO sobre las 60 páginas más recientes: de las 39 con barra pegada arriba,
// 35 (el 90%) tenían destinos sin reservar sitio. Se pulsa «¿Cómo funciona?» y
// el título de la sección queda tapado.
//
// La última prueba es la que cuenta: se comprueba EN CHROMIUM que el titular
// queda visible después del salto. Que la cadena `scroll-padding-top` aparezca
// en el HTML no demuestra que la página se vea bien — es justo la clase de
// verificación que este repo ya ha pagado por confundir.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";
import { ensureScrollPadding } from "./ensure-scroll-padding";

const pagina = (extra = "") => `<!doctype html><html><head><style>
  body{margin:0;font:16px system-ui}
  .barra{position:sticky;top:0;height:70px;background:#fff;border-bottom:1px solid #ccc}
  /* Sin relleno arriba en el destino: así el titular queda pegado al borde de
     la sección y el caso es INEQUÍVOCO. Con 56px de padding el <h2> aterrizaba
     a 69px de una barra de 70 — el brazo de control salía verde por un pelo, y
     una prueba que se decide por un píxel no prueba nada. */
  section{padding:0 0 56px}
  h2{margin-top:0}
</style></head><body>
<header class="barra sticky top-0"><a href="#precios">Precios</a></header>
<section style="height:1200px">relleno</section>
<section id="precios"${extra}><h2 id="titular">Nuestros precios</h2><p>contenido</p></section>
<section style="height:1200px">relleno</section>
</body></html>`;

describe("ensureScrollPadding", () => {
  it("🔴 inyecta la reserva cuando hay barra fija y anclas", () => {
    const r = ensureScrollPadding(pagina());
    expect(r.changed).toBe(true);
    expect(r.html).toContain("scroll-padding-top");
  });

  it("no toca una página sin anclas", () => {
    const sinAnclas = pagina().replace('href="#precios"', 'href="/precios"');
    expect(ensureScrollPadding(sinAnclas).changed).toBe(false);
  });

  it("ni una sin barra pegada arriba", () => {
    const sinBarra = pagina().replace('class="barra sticky top-0"', 'class="barra"');
    expect(ensureScrollPadding(sinBarra).changed).toBe(false);
  });

  // BRAZO DE CONTROL. Si el modelo YA se acordó —con `scroll-mt-*` en sus
  // secciones, que es la forma de shadcn— no se le pisa su decisión.
  it("y respeta al modelo que ya lo resolvió a su manera", () => {
    expect(ensureScrollPadding(pagina(' class="scroll-mt-24"')).changed).toBe(false);
  });

  it("es idempotente: dos pasadas no meten dos reglas", () => {
    const una = ensureScrollPadding(pagina()).html;
    const dos = ensureScrollPadding(una);
    expect(dos.changed).toBe(false);
    expect(dos.html).toBe(una);
  });
});

// ── LO QUE DE VERDAD IMPORTA, con un navegador ───────────────────────────────
describe("el titular queda VISIBLE tras el salto", () => {
  async function tituarVisibleTrasSaltar(html: string): Promise<boolean> {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      // El salto, como lo hace el taller: scrollIntoView a mano.
      await page.evaluate(() => {
        document.getElementById("precios")?.scrollIntoView({ behavior: "auto", block: "start" });
      });
      await new Promise((r) => setTimeout(r, 300));
      // ¿El titular queda por DEBAJO del borde inferior de la barra?
      //
      // Se AGUARDA aquí dentro en vez de devolver la promesa: con `return
      // page.evaluate(...)` el `finally` cierra el navegador antes de que
      // resuelva, y la prueba muere con «Target closed» en vez de decir si el
      // titular se veía. Pasó al escribirla.
      const visible = await page.evaluate(() => {
        const t = document.getElementById("titular")!.getBoundingClientRect();
        const b = document.querySelector(".barra")!.getBoundingClientRect();
        return t.top >= b.bottom;
      });
      return visible;
    } finally {
      await browser.close();
    }
  }

  it("🔴 SIN la reserva, el titular queda tapado por la barra", async () => {
    expect(await tituarVisibleTrasSaltar(pagina())).toBe(false);
  }, 60_000);

  it("y CON ella, se ve entero", async () => {
    expect(await tituarVisibleTrasSaltar(ensureScrollPadding(pagina()).html)).toBe(true);
  }, 60_000);
});
