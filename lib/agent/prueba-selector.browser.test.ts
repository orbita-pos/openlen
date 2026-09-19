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

  // ⚠️ EL MENSAJE CAMBIÓ el 2026-09-19, y la razón está en el bloque de «pulsar
  // por nombre» del final: un selector que no es CSS ya no muere ahí — se busca
  // como NOMBRE, porque el modelo escribe «Añadir al carrito» más a menudo que
  // un selector válido. Lo que esta prueba vigila sigue intacto: no revienta, y
  // sale como fallo DE LA PRUEBA sin acusar a la página.
  it("un selector que ni siquiera es CSS no revienta, y no acusa a la página", async () => {
    const fallos = await correr(LISTA, [
      { clic: "#marcar", veces: 1, entonces: [{ donde: "((", que: "cambia" }] },
    ]);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    // Dice las DOS cosas que se intentaron, que es lo que manda a buscar al
    // sitio correcto: ni el selector existe, ni hay nada que se llame así.
    expect(fallos[0]!.mensaje).toMatch(/ni existe el selector.*ni hay nada pulsable/);
  }, 60_000);
});

// LOS OTROS DOS FALLOS DE LA CORRIDA DEL 2026-09-04, y son el mismo.
//
// `una-seccion` (3 campos `required`) y `saas` (1) fueron acusadas de no
// enseñar su mensaje de exito. Las dos lo tenian perfectamente cableado: la
// prueba pulsaba «enviar» SIN RELLENAR NADA, el navegador bloqueaba por la
// validacion nativa y el `submit` no llegaba a dispararse jamas.
//
// No es un defecto del programa —el navegador hace lo correcto— sino del
// prompt, que no le decia al modelo que rellenara los campos. Estas dos
// pruebas fijan las dos mitades: que el olvido se ve, y que la regla nueva
// («rellenalos en el MISMO paso») de verdad lo arregla.
describe("un formulario con `required` exige rellenarlo en el mismo paso", () => {
  const OBLIGATORIO = marco(`
    <form id="f">
      <input id="nombre" required>
      <input id="email" type="email" required>
      <button type="submit" id="enviar">Enviar</button>
    </form>
    <div id="exito" style="display:none">¡Gracias!</div>
    <script>
      document.getElementById('f').addEventListener('submit', function (e) {
        e.preventDefault();
        document.getElementById('exito').style.display = 'block';
      });
    </script>`);

  it("sin rellenar, la validacion del navegador bloquea — y eso NO es la pagina", async () => {
    const fallos = await correr(OBLIGATORIO, [
      { clic: "#enviar", veces: 1, entonces: [{ donde: "#exito", que: "visible" }] },
    ]);
    // Se reproduce el falso positivo medido: la pagina esta bien y la prueba
    // falla. Es la razon de la linea nueva del prompt.
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.mensaje).toContain("#exito");
  }, 60_000);

  it("rellenandolo en el MISMO paso, la promesa se cumple", async () => {
    const fallos = await correr(OBLIGATORIO, [
      {
        escribe: { "#nombre": "Ana", "#email": "ana@ejemplo.com" },
        clic: "#enviar",
        veces: 1,
        entonces: [{ donde: "#exito", que: "visible" }],
      },
    ]);
    expect(fallos, `acuso a una pagina correcta: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// PULSAR POR NOMBRE, COMO EL `find` DE CLAUDE CODE (2026-09-19).
//
// 🔴 POR QUÉ, y sale de una medición, no de una idea. Cuatro corridas del
// escenario `carrito` dejaron la suite a cero porque el modelo nunca conseguía
// declarar una promesa con acción. Al leer el JavaScript que escribe de verdad
// —proyecto conservado— se ve por qué exigirle un `#id` era exigir lo imposible:
//
//   var menos = document.createElement('button');   // «−», «+», «Quitar»
//   menos.addEventListener('click', …)
//
// Los botones de añadir se cablean POR CLASE, y cuatro de los cinco manejadores
// viven en elementos creados en tiempo de ejecución: sin id, y sin existir
// siquiera en el documento guardado. Lo único que todos tienen es su TEXTO.
//
// LA VARA: en Claude Code nunca se le pide al modelo un selector único. O el
// sistema reparte identidad (`ref_N` de `read_page`) o el elemento se nombra
// por su texto (`find`: «elementos cuya línea del árbol de accesibilidad
// —rol/nombre/texto— contiene la consulta»). Esto es lo segundo, que es lo que
// cabe en una promesa declarativa.
describe("pulsar por nombre cuando no hay selector", () => {
  // La página del carrito, con el botón creado EN EJECUCIÓN: no está en el
  // HTML, no tiene id, y es justo el que el modelo cablea.
  const CREADO_AL_VUELO = marco(`
    <div id="zona"></div>
    <b id="total">0</b>
    <script>
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Añadir al carrito';
      b.addEventListener('click', function () {
        document.getElementById('total').textContent = '2480';
      });
      document.getElementById('zona').appendChild(b);
    </script>`);

  it("🔴 un botón sin id y creado al vuelo se pulsa por su texto", async () => {
    const fallos = await correr(CREADO_AL_VUELO, [
      { clic: "Añadir al carrito", entonces: [{ donde: "#total", que: "cambia" }] },
    ]);
    expect(fallos, `no lo encontró: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  it("le da igual la caja y los espacios de más", async () => {
    const fallos = await correr(CREADO_AL_VUELO, [
      { clic: "  añadir AL carrito ", entonces: [{ donde: "#total", que: "cambia" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 60_000);

  // CONTRA-PRUEBA 1: un nombre que señala a varios NO se resuelve por descarte.
  // Pulsar «el primero que aparezca» convertiría una promesa ambigua en una
  // promesa que pasa por suerte.
  it("🔴 CONTRA-PRUEBA: un nombre que casa con varios botones no vale", async () => {
    const tres = marco(`
      <button type="button" class="btn-add">Añadir</button>
      <button type="button" class="btn-add">Añadir</button>
      <button type="button" class="btn-add">Añadir</button>
      <b id="total">0</b>`);
    const fallos = await correr(tres, [
      { clic: "Añadir", entonces: [{ donde: "#total", que: "cambia" }] },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toMatch(/señala 3/);
    // Y NO ACUSA A LA PÁGINA: es un fallo DE LA PRUEBA.
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  // CONTRA-PRUEBA 2: un selector CSS que sí casa sigue ganando. Esto no cambia
  // ninguna promesa que ya funcionaba.
  it("CONTRA-PRUEBA: el selector CSS de siempre sigue mandando", async () => {
    const conId = marco(`
      <button type="button" id="agregar">Añadir al carrito</button>
      <b id="total">0</b>
      <script>
        document.getElementById('agregar').addEventListener('click', function () {
          document.getElementById('total').textContent = '99';
        });
      </script>`);
    const fallos = await correr(conId, [
      { clic: "#agregar", entonces: [{ donde: "#total", que: "es", valor: "99" }] },
    ]);
    expect(fallos).toEqual([]);
  }, 60_000);
});
