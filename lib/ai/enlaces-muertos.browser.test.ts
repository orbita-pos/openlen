// EL BOTÓN QUE NO HACE NADA — qué cuenta como enlace muerto, y qué NO.
//
// 🔴 EL CASO, medido el 2026-09-07 sobre las 48 páginas del corpus de evals:
// `contradictorio` puntuó LIMPIA con SEIS botones de compra —el principal de
// 3.450 €— apuntando a `#comprar` sin que la página tuviera esa sección. Es el
// único defecto de la lista que la captura no puede enseñar y el JavaScript
// tampoco grita: la foto sale perfecta, el visitante pulsa «Comprar» y no pasa
// nada. Salió en 6 de 48 páginas (13%) y nunca lo detectó nadie.
//
// 🔴 Y LO QUE NO CUENTA IMPORTA MÁS, porque aquí es donde murió el veredicto
// `prueba`: acusó a 3 páginas de 11 y acertó en 0. En la misma medición,
// `href="#"` a secas salió 45 veces en 12 de 16 páginas — es el idioma del
// modelo para un control, y el navegador lo honra subiendo al principio.
// Contarlo habría acusado a casi todas y acertado en ninguna. Las contra-
// pruebas de abajo son las que sujetan esa línea.
//
// ⚠️ ESTAS PRUEBAS TIENEN QUE SER DE NAVEGADOR, por la misma razón que las de
// `desborde-culpable.browser.test.ts`: las de `visual-quality-renderer.test.ts`
// mockean `page.evaluate`, así que NUNCA ejecutan la sonda. Un fallo dentro de
// ella vive ahí con la suite en verde.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

const marco = (cuerpo: string, cabeza = "") => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}</style>
${cabeza}</head><body>${cuerpo}</body></html>`;

const anclas = async (html: string) =>
  (await renderVisualQualityViewports(html, {}))?.deadAnchors ?? [];

describe("enlaces que no llevan a ningún sitio", () => {
  it("🔴 el caso real: seis «Comprar» a una sección que no existe", async () => {
    const encontradas = await anclas(
      marco(`
        <h1>Silla de diseño</h1>
        <a href="#comprar">Comprar hoy</a>
        <a href="#comprar">Comprar ahora — 3.450 €</a>
        <a href="#comprar">Reservar mi unidad</a>
        <section id="garantia"><h2>Garantía</h2></section>`),
    );
    expect(encontradas).toHaveLength(1);
    expect(encontradas[0]!.destino).toBe("#comprar");
    expect(encontradas[0]!.veces).toBe(3);
    // El TEXTO es la dirección que le sirve a una persona.
    expect(encontradas[0]!.texto).toBe("Comprar hoy");
  }, 60_000);

  it("un ancla que SÍ llega no se acusa", async () => {
    expect(
      await anclas(
        marco(`<a href="#precios">Ver precios</a><section id="precios">…</section>`),
      ),
    ).toEqual([]);
  }, 60_000);

  // ── las contra-pruebas que evitan repetir lo de `prueba` ──────────────────

  it("CONTRA-PRUEBA: `href=\"#\"` a secas NO cuenta — sale 45 veces en el corpus", async () => {
    expect(await anclas(marco(`<a href="#">Iniciar sesión</a><a href="#">Menú</a>`))).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: `#top` no cuenta — el navegador sube al principio sin elemento", async () => {
    expect(await anclas(marco(`<a href="#top">Volver arriba</a>`))).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: el `<a name>` heredado sigue siendo un destino", async () => {
    expect(
      await anclas(marco(`<a href="#viejo">Ir</a><a name="viejo"></a>`)),
    ).toEqual([]);
  }, 60_000);

  // Un caso por `it`, y el tope de 60s de todos: un render ronda los 2,6s
  // suelto pero pasa de 5 dentro de la suite entera, y un rojo por contención
  // no dice nada de la sonda. El tope es el mismo que usan las otras dos
  // pruebas de navegador de este directorio.
  it("CONTRA-PRUEBA: un destino en árabe no se acusa — salió en `arabe` del corpus", async () => {
    expect(
      await anclas(marco(`<a href="#خبز">خبز</a><section id="خبز">…</section>`)),
    ).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: un destino escapado en la URL y con acento en el id tampoco", async () => {
    expect(
      await anclas(marco(`<a href="#garant%C3%ADa">Garantía</a><section id="garantía">…</section>`)),
    ).toEqual([]);
  }, 60_000);

  // 🔴 ÉSTA ES LA RAZÓN DE MEDIR EN EL DOM Y NO SOBRE EL HTML. El JavaScript del
  // modelo puede crear la sección; un escaneo estático la acusaría de muerta
  // cuando para el visitante existe. Si alguien mueve esta sonda al HTML, esta
  // prueba es la que se pone roja.
  it("🔴 una sección que crea el JavaScript del modelo NO es un enlace muerto", async () => {
    expect(
      await anclas(
        marco(
          `<a href="#tarde">Ver</a><div id="host"></div>`,
          `<script>document.addEventListener("DOMContentLoaded",function(){
             var s=document.createElement("section"); s.id="tarde"; s.textContent="llegué";
             document.getElementById("host").appendChild(s);
           });</script>`,
        ),
      ),
    ).toEqual([]);
  }, 60_000);

  it("una página sin enlaces internos no trae el campo", async () => {
    const r = await renderVisualQualityViewports(marco(`<h1>Hola</h1>`), {});
    expect(r?.deadAnchors).toBeUndefined();
  }, 60_000);
});
