// LO QUE LA PÁGINA LLAMA Y AQUÍ NO EXISTE.
//
// El medidor sirve el documento desde un servidor del proceso
// (`origen-de-medida.ts`) que sólo conoce UNA ruta: la del documento. Cualquier
// otra da 404. Así que un formulario que postea a `/api/f/<sub>`, el chat que
// habla con `/api/chat/…` o la analítica que late contra `/c/<id>` no fallan
// por un defecto de la página: fallan porque no hay a quién llamar.
//
// Hasta hoy eso se medía en silencio, y el silencio se lee como «funciona».
// D6 de la spec 2026-09-15: lo que no se replica, se dice.
//
// ⚠️ DE NAVEGADOR a propósito: las pruebas de `visual-quality-renderer.test.ts`
// mockean la página, así que ahí no hay red que observar.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

const marco = (cuerpo: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}</style>
</head><body>${cuerpo}</body></html>`;

describe("las rutas que sólo responden publicadas se apuntan", () => {
  it("🔴 un envío a /api/f/ sale en la medida", async () => {
    const medida = await renderVisualQualityViewports(
      marco(`
        <h1>Contacto</h1>
        <p>Texto suficiente para que la medida tenga algo que mirar.</p>
        <script>
          fetch('/api/f/mi-negocio', { method: 'POST', body: '{}' }).catch(function () {});
        </script>`),
    );
    expect(medida).not.toBeNull();
    const llamadas = medida?.llamadasSoloPublicada ?? [];
    expect(llamadas.some((l) => l.startsWith("/api/f/mi-negocio"))).toBe(true);
  }, 60_000);

  it("y el latido de la analítica también", async () => {
    const medida = await renderVisualQualityViewports(
      marco(`
        <h1>Inicio</h1>
        <script>
          fetch('/c/4f9c10cb-8781-48f1-b291-c5d146579f09', { method: 'POST', body: '{}' }).catch(function () {});
        </script>`),
    );
    expect((medida?.llamadasSoloPublicada ?? []).some((l) => l.startsWith("/c/"))).toBe(true);
  }, 60_000);

  it("CONTRA-PRUEBA: una llamada corriente no cuenta, y sin llamadas el campo no aparece", async () => {
    // Que no se convierta en «la página hace peticiones»: lo que se apunta es
    // la lista corta de rutas que SÓLO existen publicadas, no cualquier 404.
    const conOtra = await renderVisualQualityViewports(
      marco(`<h1>Inicio</h1><script>fetch('/una-ruta-cualquiera').catch(function(){});</script>`),
    );
    expect(conOtra?.llamadasSoloPublicada).toBeUndefined();

    const limpia = await renderVisualQualityViewports(marco(`<h1>Inicio</h1><p>Nada más.</p>`));
    expect(limpia).not.toBeNull();
    expect(limpia?.llamadasSoloPublicada).toBeUndefined();
  }, 90_000);
});
