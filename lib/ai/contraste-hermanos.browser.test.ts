// EL PASEO POR HERMANOS TAMBIÉN TIENE QUE SABER RENDIRSE.
//
// 🔴 MEDIDO el 2026-09-02 en la portada de una inmobiliaria: titular BLANCO
// sobre una foto oscurecida por un velo hermano. El paseo por hermanos sólo
// lee `backgroundColor` —transparente tanto en el <img> como en el div del
// degradado— así que saltaba los dos y caía al blanco por defecto del <body>.
// Resultado: «#ffffff sobre #ffffff a 1.00:1», un hallazgo INVENTADO que costó
// 17 ediciones, 8 búsquedas de foto, y dejó la portada peor que la de partida:
// media pantalla en sólido tapando la foto que el usuario había pedido.
//
// El paseo por ANCESTROS ya trata las dos cosas bien (foto ⇒ incierto,
// degradado ⇒ velo compuesto). Esto sujeta que el de hermanos haga lo mismo.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

// Un PNG 1×1 como data: URI — carga sin red y sin fichero, así que la prueba
// no depende de que el catálogo de imágenes esté vivo.
const FOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// La portada de Aurora reducida a su esqueleto: foto hermana + velo hermano +
// texto blanco encima. Abajo, un brazo de control invisible DE VERDAD.
//
// ⚠️ El brazo de control va en NEGRO SOBRE NEGRO, no en blanco sobre blanco, y
// no es cosmético: la deduplicación de hallazgos usa la clave
// `${probe}|${background}` y en una página sin `data-ol-probe` el probe es
// siempre -1, así que sólo sobrevive UN hallazgo por color de fondo. Con el
// control también en #ffffff, el falso positivo del titular lo tapaba y la
// prueba medía la deduplicación en vez de medir el detector.
const HERO = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
</style></head><body>
<section style="position:relative">
  <div style="position:absolute;inset:0">
    <img src="${FOTO}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(to right, rgba(2,6,23,0.90) 0%, rgba(2,6,23,0.55) 100%)"></div>
  </div>
  <div style="position:relative;padding:80px">
    <h1 style="color:#ffffff;margin:0">Encuentra casa en Monterrey</h1>
  </div>
</section>
<p style="color:#101010;background:#101010;padding:20px">Mariscos frescos desde 1987</p>
</body></html>`;

// Una foto hermana SIN velo: no se puede juzgar desde el CSS, así que la
// respuesta correcta es callarse, no decir «blanco».
const SOLO_FOTO = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
</style></head><body>
<section style="position:relative">
  <img src="${FOTO}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  <div style="position:relative;padding:80px">
    <h1 style="color:#ffffff;margin:0">Titular sobre la foto</h1>
  </div>
</section>
</body></html>`;

describe("el paseo por hermanos", () => {
  it("🔴 NO inventa blanco cuando un velo hermano oscurece la foto", async () => {
    const medido = await renderVisualQualityViewports(HERO);
    const malos = medido?.unreadableText ?? [];
    const inventado = malos.find((m) => (m.texto ?? "").includes("Monterrey"));
    expect(
      inventado,
      `hallazgo inventado sobre el titular: ${JSON.stringify(inventado)}`,
    ).toBeUndefined();
  }, 60_000);

  // BRAZO DE CONTROL, en el MISMO documento: si el arreglo cegara el detector,
  // esta prueba lo caza. Sin ella, «no encuentra nada» pasaría por éxito.
  it("y sigue viendo el texto que de verdad es invisible", async () => {
    const medido = await renderVisualQualityViewports(HERO);
    const malos = medido?.unreadableText ?? [];
    expect(malos.some((m) => (m.texto ?? "").includes("Mariscos"))).toBe(true);
  }, 60_000);

  it("se calla ante una foto hermana sin velo, en vez de medir contra el body", async () => {
    const medido = await renderVisualQualityViewports(SOLO_FOTO);
    const malos = medido?.unreadableText ?? [];
    expect(malos.some((m) => (m.texto ?? "").includes("Titular"))).toBe(false);
  }, 60_000);
});
