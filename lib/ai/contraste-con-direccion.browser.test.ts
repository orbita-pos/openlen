// EL MEDIDOR DE CONTRASTE DEVUELVE LA DIRECCIÓN, NO SÓLO EL NÚMERO.
//
// 🔴 MEDIDO el 2026-08-30 en una sesión real: el veredicto que llegaba al
// Agente era «1 texto(s) que nadie puede leer — el peor a 1.00:1» y nada más.
// Con eso dio CUATRO rondas oscureciendo el mismo velo del hero sin acertar, y
// en la última escribió veinte párrafos razonando en voz alta cuál de los
// textos de la página sería el culpable. Tenía el ratio y ninguna forma de
// saber a quién pertenecía.
//
// `verify.test.ts` prueba que el MENSAJE nombra el elemento, con dobles. Esto
// prueba la otra mitad, la que ningún doble puede: que el medidor REAL, en un
// navegador de verdad, saque el texto del elemento culpable. Sin esto, el
// mensaje sabría formatear una dirección que nunca llega.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

// Blanco sobre blanco: ilegible sin ambigüedad. El segundo texto es legible y
// sirve de brazo de control dentro del mismo documento — si el medidor lo
// marcara también, estaría inventando hallazgos.
const DOC = `<!doctype html><html><head><style>
  body{margin:0;background:#ffffff;font:16px/1.4 system-ui}
  .invisible{color:#ffffff;background:#ffffff;padding:20px}
  .legible{color:#111111;background:#ffffff;padding:20px}
</style></head><body>
<p class="invisible">Mariscos frescos desde 1987</p>
<p class="legible">Este se lee perfectamente</p>
</body></html>`;

describe("el medidor de contraste da la dirección", () => {
  it("🔴 nombra el TEXTO del elemento ilegible, no sólo su ratio", async () => {
    const medido = await renderVisualQualityViewports(DOC);
    const malos = medido?.unreadableText ?? [];
    expect(malos.length).toBeGreaterThan(0);

    const culpable = malos.find((m) => (m.texto ?? "").includes("Mariscos"));
    expect(culpable, `ninguno trae el texto: ${JSON.stringify(malos)}`).toBeTruthy();
    expect(culpable!.contrast).toBeLessThan(2);
    // Las DOS mitades del problema: el mensaje dice «cambia su color o el de su
    // fondo», así que los dos tienen que viajar o el consejo no se puede seguir.
    expect(culpable!.color).toBe("#ffffff");
    expect(culpable!.background).toBe("#ffffff");
    expect(culpable!.etiqueta).toBe("p");
  }, 60_000);

  // BRAZO DE CONTROL: el texto legible del MISMO documento no aparece. Sin
  // esto, un medidor que marcara todo pasaría la prueba de arriba.
  it("y no marca el texto que sí se lee", async () => {
    const medido = await renderVisualQualityViewports(DOC);
    const malos = medido?.unreadableText ?? [];
    expect(malos.some((m) => (m.texto ?? "").includes("perfectamente"))).toBe(false);
  }, 60_000);
});
