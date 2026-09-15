// PULSAR SE LO COMÍA LA BARRA DE NAVEGACIÓN.
//
// 🔴 MEDIDO el 2026-09-15 sobre las 16 páginas de usuario de producción que
// llevan JavaScript — la población que importa, no un corpus sintético:
//
//   · de 136 botones reales, el pase a ciegas pulsaba 5.  (4%)
//   · en 11 de las 16 páginas pulsaba CERO botones.
//   · hallazgos que sólo aparecían pulsando: 0 de 16.
//
// Ese 0 no era «las páginas están limpias»: era que no se estaba pulsando nada
// que pudiera romperse. El selector recoge `a[href]` junto a los botones y
// corta por `slice(0, 8)` en ORDEN DEL DOM — y en una landing los ocho primeros
// son siempre la barra de navegación. El tope se agotaba antes de llegar a un
// solo control de verdad. Con `preventDefault` puesto, además, pulsar un enlace
// de navegación no hace absolutamente nada.
//
// 🔴 Y LA PRUEBA QUE YA EXISTÍA LO TAPABA. `visual-quality-renderer.test.ts`
// prueba esto con una página de UN botón y nada más, así que el tope nunca se
// agota y la barra no existe. Verde durante todo el tiempo que el pase estuvo
// disparando a la nada. Es la misma lección que este repo ya tiene apuntada
// varias veces: una prueba que no tiene la FORMA de lo real no protege lo real.
//
// Lo de aquí abajo tiene la forma de las 16.
import { describe, expect, it } from "vitest";
import { PULSAR_CONTROLES } from "./press-controls";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

/** Una landing como las del corpus: barra de navegación, héroe con dos enlaces
 *  de llamada a la acción, y los controles de verdad más abajo. */
const landing = (cuerpo: string, script: string) => `<!doctype html><html><head>
<meta charset="utf-8"><style>body{margin:0;font:16px/1.4 Arial,sans-serif;background:#fff;color:#111}</style>
</head><body>
  <nav>
    <a href="#inicio">Marca</a> <a href="#producto">Producto</a> <a href="#precios">Precios</a>
    <a href="#casos">Casos</a> <a href="#blog">Blog</a> <a href="#faq">Preguntas</a>
    <a href="#acceso">Acceso</a> <a href="#registro">Empezar gratis</a>
  </nav>
  <h1 style="font-size:40px">Un titular</h1>
  <a href="#registro">Probarlo ahora</a> <a href="#demo">Ver la demo</a>
  ${cuerpo}
  <script>${script}</script>
</body></html>`;

const gritos = async (html: string) => (await renderVisualQualityViewports(html))?.runtimeErrors ?? [];
/** El mismo programa por la rama que SÍ devuelve su resultado: cuántos pulsó. */
const cuantosPulsa = async (html: string) =>
  (await renderVisualQualityViewports(html, {}, { behaviorProgram: PULSAR_CONTROLES }))?.behaviorResult;

describe("pulsar apunta a los controles, no a la navegación", () => {
  it("🔴 el caso del corpus: el botón roto está DETRÁS de la barra de navegación", async () => {
    // Exactamente el defecto que este pase existe para ver —un manejador que
    // revienta en la segunda jugada— pero en una página con la forma de las de
    // verdad. Con el pase mirando al DOM en orden, esto pasaba por sano.
    const encontrados = await gritos(
      landing(
        `<button id="b">Añadir al carrito</button><span id="n">0</span>`,
        `var v=0;document.getElementById("b").addEventListener("click",function(){
           v++; if (v>1) { null.x = 1; } document.getElementById("n").textContent=String(v);
         });`,
      ),
    );
    expect(encontrados.join(" "), "el tope se lo comió la navegación").toMatch(/null|undefined|TypeError/i);
  }, 60_000);

  it("y llega a un control que está por debajo de MUCHOS enlaces", async () => {
    // `425defb1` del corpus tiene 140 candidatos y 12 botones. Si el orden del
    // DOM manda, ninguno se pulsa jamás.
    const relleno = Array.from({ length: 40 }, (_, i) => `<a href="#s${i}">Sección ${i}</a>`).join(" ");
    const encontrados = await gritos(
      landing(
        `${relleno}<button id="b">Calcular</button>`,
        `document.getElementById("b").addEventListener("click",function(){ null.x = 1; });`,
      ),
    );
    expect(encontrados.join(" ")).toMatch(/null|undefined|TypeError/i);
  }, 60_000);

  // ── lo que el nuevo orden NO puede romper ────────────────────────────────

  it("CONTRA-PRUEBA: una página SIN botones se sigue pulsando por los enlaces", async () => {
    // Los enlaces no sobran: son el relleno cuando no hay controles, y un
    // `href="#"` con manejador es un control aunque no lo parezca. Quitarlos
    // del todo cambiaría un sesgo por otro.
    const encontrados = await gritos(
      landing(``, `document.querySelector('nav a').addEventListener("click",function(){ null.x = 1; });`),
    );
    expect(encontrados.join(" ")).toMatch(/null|undefined|TypeError/i);
  }, 60_000);

  it("CONTRA-PRUEBA: el tope sigue puesto — cada clic dispara trabajo del modelo", async () => {
    const relleno = Array.from({ length: 60 }, (_, i) => `<button id="x${i}">B${i}</button>`).join("");
    expect(await cuantosPulsa(landing(relleno, ``)), "el tope de 8 se ha soltado").toBe(8);
  }, 60_000);

  it("CONTRA-PRUEBA: un botón que funciona no inventa ningún grito", async () => {
    const encontrados = await gritos(
      landing(
        `<button id="b">Sumar</button><span id="n">0</span>`,
        `var v=0;document.getElementById("b").addEventListener("click",function(){
           v++; document.getElementById("n").textContent=String(v);
         });`,
      ),
    );
    expect(encontrados).toEqual([]);
  }, 60_000);
});
