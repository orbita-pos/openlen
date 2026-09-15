// EL PLAZO, CONTRA UN CUELGUE DE VERDAD Y CON LOS NÚMEROS DE VERDAD.
//
// `render-con-plazo.test.ts` prueba el MECANISMO con dobles y plazos de
// juguete: que vence, que mata, que no envenena la cola. Lo que no puede probar
// es que los topes REALES acoten un Chromium REAL — y esa es justo la parte que
// falló en producción, porque allí no había ningún tope.
//
// 🔴 Y EL CUELGUE DE AQUÍ NO ES EL DE PRODUCCIÓN, A PROPÓSITO. Aquel era un
// `prompt()` y ya se descarta (`dialogos-nativos.browser.test.ts`). Éste es un
// `while (true)` en un manejador: el mismo síntoma por otra puerta, que es la
// única forma de comprobar que lo que arreglamos fue la CLASE y no el caso.
// Si algún día alguien quita el plazo «porque los diálogos ya se cierran», esta
// prueba es la que se pone roja.
import { describe, expect, it } from "vitest";
import { RENDER_PASO_MS, RENDER_TOPE_MS, renderVisualQualityViewports } from "./visual-quality-renderer";

const marco = (cuerpo: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}</style>
</head><body>${cuerpo}</body></html>`;

describe("una página que se cuelga sola no cuelga el turno", () => {
  it("🔴 un `while (true)` en un manejador: la medida VUELVE, y dentro del tope", async () => {
    const arranque = Date.now();

    const medida = await renderVisualQualityViewports(
      marco(`
        <h1>Mis decks</h1>
        <p>Texto suficiente para que la medida tenga algo que mirar.</p>
        <button id="btn-nuevo-deck">Nuevo deck</button>
        <script>
          document.getElementById('btn-nuevo-deck').addEventListener('click', function () {
            // El hilo de la página no vuelve nunca. Chromium sigue vivo y
            // respondiendo al protocolo, así que NADA aguas abajo se entera.
            while (true) {}
          });
        </script>`),
    );
    const tardo = Date.now() - arranque;

    // «No se pudo medir» es honesto; colgarse no lo es. Ver el contrato
    // fail-soft de `renderVisualQualityViewports`.
    expect(medida).toBeNull();
    // Y VUELVE POR EL PLAZO. El margen es generoso a propósito —el arranque de
    // Chromium y las dos capturas ya se han pagado cuando se pulsa— pero está
    // MUY por debajo del infinito que había antes, y por debajo de los 90 s a
    // los que Caddy corta la respuesta, que es el número que convirtió esto en
    // «network error» para el usuario.
    expect(tardo).toBeLessThan(RENDER_TOPE_MS + RENDER_PASO_MS);
    expect(tardo).toBeLessThan(90_000);
  }, 120_000);
});
