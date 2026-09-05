// LA PRUEBA DECLARADA, EJECUTADA DE VERDAD — el guardia y el conteo.
//
// 🔴 POR QUÉ ESTAS PRUEBAS SON DE NAVEGADOR Y NO PUEDEN SER OTRA COSA.
// `visual-quality-renderer.test.ts` mockea `page.evaluate`, así que NUNCA
// ejecuta el programa que genera `specProgram`. Los dos defectos que este
// fichero fija vivían justo ahí dentro, con la suite entera en verde.
//
// Los dos, medidos el 2026-09-04 sobre una corrida real de 16 páginas:
//
// 1. EL GUARDIA MATABA EL ENVÍO. El programa hacía `preventDefault()` en
//    captura sobre `click` con el comentario «se impide sólo la acción por
//    defecto: el manejador del modelo corre igual». Falso para un
//    `type="submit"`: la acción por defecto de ese clic ES disparar el evento
//    `submit`, que es donde el modelo engancha su manejador. La página
//    `una-seccion` fue acusada de no enseñar su mensaje de éxito teniéndolo
//    perfectamente cableado.
//
// 2. LA REGEX DE SELECTORES tiraba pruebas buenas. De las 11 que el modelo
//    declaró, 2 se perdieron ahí — entre ellas un `:nth-child(3)`, que es LA
//    forma estándar de CSS de señalar un solo elemento, o sea exactamente lo
//    que el prompt pedía. Ahora se CUENTA en el navegador, que es la regla del
//    `Edit` de Claude Code: casa una vez o falla.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";
import { specProgram, leerFallos } from "./behavior-spec";
import type { PasoSpec } from "./behavior-spec";

async function correr(html: string, pasos: PasoSpec[]) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const bruto = await page.evaluate(specProgram(pasos));
    return leerFallos(bruto);
  } finally {
    await browser.close();
  }
}

const marco = (cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`;

// Un formulario como el que escribe el modelo: botón de envío + manejador en el
// evento `submit` del formulario, que es donde lo pone cualquiera.
const FORMULARIO = marco(`
  <form id="f">
    <input id="nombre">
    <button type="submit" id="enviar">Enviar</button>
  </form>
  <div id="exito" style="display:none">¡Gracias!</div>
  <script>
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('exito').style.display = 'block';
    });
  </script>`);

describe("el guardia no puede matar lo que la prueba viene a comprobar", () => {
  it("un envío de formulario llega a su manejador y la promesa se cumple", async () => {
    const fallos = await correr(FORMULARIO, [
      { escribe: { "#nombre": "Ana" }, clic: "#enviar", veces: 1, entonces: [{ donde: "#exito", que: "visible" }] },
    ]);
    expect(fallos, `acusó a una página correcta: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  // BRAZO DE CONTROL: sin él, la prueba de arriba pasaría igual si el programa
  // no comprobara NADA. Una página que de verdad no cumple tiene que fallar.
  it("CONTRA-PRUEBA: si la página NO enseña el mensaje, sí se acusa", async () => {
    const rota = FORMULARIO.replace("style.display = 'block'", "style.display = 'none'");
    const fallos = await correr(rota, [
      { escribe: { "#nombre": "Ana" }, clic: "#enviar", veces: 1, entonces: [{ donde: "#exito", que: "visible" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("#exito");
  }, 60_000);
});

describe("el selector se CUENTA en el navegador, no se adivina con una regex", () => {
  const LISTA = marco(`
    <ul id="lista">
      <li class="fila">uno</li>
      <li class="fila">dos</li>
      <li class="fila" id="tres">tres</li>
    </ul>
    <button id="marcar">marcar</button>
    <script>
      document.getElementById('marcar').addEventListener('click', function () {
        document.getElementById('tres').textContent = 'TRES marcado';
      });
    </script>`);

  // El caso que la regex tiraba: `:nth-child` es la forma estándar de señalar
  // UN elemento entre hermanos — justo lo que el prompt pide.
  it("un `:nth-child` señala uno y la prueba CORRE", async () => {
    const fallos = await correr(LISTA, [
      { clic: "#marcar", veces: 1, entonces: [{ donde: "#lista .fila:nth-child(3)", que: "contiene", valor: "marcado" }] },
    ]);
    expect(fallos, `un selector válido fue rechazado: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  it("un selector AMBIGUO no acusa a la página: es fallo DE LA PRUEBA", async () => {
    const fallos = await correr(LISTA, [
      { clic: "#marcar", veces: 1, entonces: [{ donde: ".fila", que: "contiene", valor: "marcado" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toContain("3 elementos");
  }, 60_000);

  it("y uno que no existe, igual — la página no puede fallar lo que no se señala", async () => {
    const fallos = await correr(LISTA, [
      { clic: "#noExiste", veces: 1, entonces: [{ donde: "#tres", que: "cambia" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  it("un selector que ni siquiera es CSS se dice como tal, sin reventar", async () => {
    const fallos = await correr(LISTA, [
      { clic: "#marcar", veces: 1, entonces: [{ donde: "((", que: "cambia" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toContain("no es CSS válido");
  }, 60_000);
});
