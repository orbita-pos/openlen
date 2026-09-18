// EL ALMACÉN DE LA PÁGINA, CONTESTADO EN LA MEDIDA.
//
// Hasta el 2026-09-18, `/api/d` era una ruta «sólo publicada»: el medidor la
// apuntaba y a Len se le decía «no es un fallo de la página». Ese día un
// carrito que no guardaba nada pasó así. Desde entonces la contesta el
// sustituto (`lib/page-data/sustituto.ts`) con las reglas del servidor real,
// y lo que éste rechazaría es un hecho que vuelve al modelo.
//
// DE NAVEGADOR a propósito, como `llamadas-solo-publicada.browser.test.ts`: la
// petición tiene que salir de una página de verdad, con su `Referer`, y llegar
// al servidor de medida.
import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "./visual-quality-renderer";

const conAlmacen = (script: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}</style>
</head><body>
<script type="application/json" data-ol-stores>{"carrito":{"visitante":"propio","campos":{"items":"lista"}}}</script>
<h1>Tienda</h1><p>Texto suficiente para que la medida tenga algo que mirar.</p>
<script>${script}</script>
</body></html>`;

describe("el medidor contesta /api/d con las reglas del servidor real", () => {
  it("🔴 el subdominio inventado de un borrador vuelve RECHAZADO, y ya no como «sólo publicada»", async () => {
    const medida = await renderVisualQualityViewports(
      conAlmacen(`fetch('/api/d/carrito/carrito', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ items: [1] }) }).catch(function () {});`),
      {},
      { sub: null },
    );
    expect(medida?.llamadasADatos).toContainEqual({
      metodo: "POST",
      ruta: "/api/d/carrito/carrito",
      status: 403,
      error: "origen_invalido",
    });
    expect((medida?.llamadasSoloPublicada ?? []).some((l) => l.startsWith("/api/d/"))).toBe(false);
  }, 60_000);

  it("la forma sin subdominio se guarda y se lee", async () => {
    const medida = await renderVisualQualityViewports(
      conAlmacen(`
        fetch('/api/d/carrito', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ items: [1, 2] }) })
          .then(function () { return fetch('/api/d/carrito'); }).catch(function () {});`),
      {},
      { sub: null },
    );
    const llamadas = medida?.llamadasADatos ?? [];
    expect(llamadas).toContainEqual({ metodo: "POST", ruta: "/api/d/carrito", status: 200 });
    expect(llamadas).toContainEqual({ metodo: "GET", ruta: "/api/d/carrito", status: 200 });
  }, 60_000);

  it("CONTRA-PRUEBA: sin saber el subdominio del proyecto, no acusa `/api/d/<sub>/…`", async () => {
    const medida = await renderVisualQualityViewports(
      conAlmacen(`fetch('/api/d/volcanica/carrito', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ items: [1] }) }).catch(function () {});`),
    );
    expect(medida?.llamadasADatos).toContainEqual({ metodo: "POST", ruta: "/api/d/volcanica/carrito", status: 200 });
  }, 60_000);
});
