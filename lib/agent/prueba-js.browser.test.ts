// LA PRUEBA EN JAVASCRIPT (opción A) — ejecutada de verdad.
//
// ⚠️ DE NAVEGADOR, y no puede ser otra cosa: la suite normal mockea
// `page.evaluate`, así que un fallo dentro del programa viviría ahí con todo en
// verde. Es la trampa que ya escondió dos defectos esta misma semana.
//
// Lo que estas pruebas fijan no es «el JS del modelo corre»: es que los TRES
// aprendizajes que costaron corridas pagadas siguen dentro de los primitivos y
// NO dependen de que el modelo se acuerde de ellos. Ésa es la diferencia entre
// esto y la «forma libre» que ninguna herramienta grande acepta.
import { describe, expect, it } from "vitest";
import puppeteer from "puppeteer";
import { leerFallos, leerVacuas, programaJs, programaSinAccionesJs, VENTANA_PRUEBA_MS } from "./prueba-js";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { brazoSinAcciones } from "./evals/brazo-sin-acciones";

async function correr(html: string, codigo: string) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return leerFallos(await page.evaluate(programaJs(codigo)));
  } finally {
    await browser.close();
  }
}

const marco = (cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`;

const FORMULARIO = marco(`
  <form id="f"><input id="nombre"><button type="submit" id="enviar">Enviar</button></form>
  <div id="exito" style="display:none">¡Gracias!</div>
  <script>
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('exito').style.display = 'block';
    });
  </script>`);

// Un reloj que sólo cambia DESPUÉS de un segundo: si la ventana de espera no
// estuviera dentro del primitivo, esto fallaría siempre — que es exactamente lo
// que pasó el 2026-08-23 con un pomodoro correcto.
const RELOJ = marco(`
  <div id="reloj">25:00</div><button id="empezar">empezar</button>
  <script>
    document.getElementById('empezar').addEventListener('click', function () {
      setTimeout(function () { document.getElementById('reloj').textContent = '24:59'; }, 1000);
    });
  </script>`);

// El punto ciego MEDIDO: el comportamiento se escribe y el CSS del estado se
// olvida. La clase se pone, no hay error y el control queda mudo.
const MUDO = marco(`
  <button id="filtro">filtrar</button><div id="panel">contenido</div>
  <script>
    document.getElementById('filtro').addEventListener('click', function () {
      document.getElementById('panel').classList.add('activo'); // y nadie define .activo
    });
  </script>`);

describe("el modelo escribe JS, pero las lecciones viven en los primitivos", () => {
  it("la VENTANA la pone `ui`, no el modelo: un cambio a 1s se ve sin esperar a mano", async () => {
    const fallos = await correr(RELOJ, `
      const antes = await ui.texto("#reloj");
      await ui.clic("#empezar");
      await ui.cambiaDe("#reloj", antes);
    `);
    expect(fallos, `no esperó: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  it("el GUARDIA deja pasar el envío del formulario", async () => {
    const fallos = await correr(FORMULARIO, `
      await ui.escribe("#nombre", "Ana");
      await ui.clic("#enviar");
      await ui.visible("#exito");
    `);
    expect(fallos, `acusó a una página correcta: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  it("`estiloCambiaDe` sigue viendo el control MUDO — el punto ciego medido", async () => {
    const fallos = await correr(MUDO, `
      const antes = await ui.estilo("#panel", "background-color");
      await ui.clic("#filtro");
      await ui.estiloCambiaDe("#panel", "background-color", antes);
    `);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("background-color");
  }, 60_000);

  // BRAZO DE CONTROL: sin esto, todo lo de arriba pasaría igual si el programa
  // no comprobara nada.
  it("CONTRA-PRUEBA: una página que NO cumple sí se acusa", async () => {
    const rota = FORMULARIO.replace("style.display = 'block'", "style.display = 'none'");
    const fallos = await correr(rota, `
      await ui.escribe("#nombre", "Ana");
      await ui.clic("#enviar");
      await ui.visible("#exito");
    `);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("#exito");
  }, 60_000);
});

describe("lo que el modelo escriba mal NO acusa a la página", () => {
  it("un selector ambiguo es fallo DE LA PRUEBA", async () => {
    const fallos = await correr(marco(`<p class="x">a</p><p class="x">b</p>`), `await ui.visible(".x");`);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toContain("2 elementos");
  }, 60_000);

  it("un programa que ni siquiera compila se dice como fallo de la prueba", async () => {
    const fallos = await correr(FORMULARIO, `await ui.clic("#enviar"  ;;;`);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  it("una variable inventada por el modelo, igual", async () => {
    const fallos = await correr(FORMULARIO, `await ui.clic(noExisteEstaVariable);`);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  it("un bucle infinito NO cuelga la medición: hay techo de pared", async () => {
    const fallos = await correr(FORMULARIO, `for (;;) { await ui.espera(10); }`);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 120_000);
});

// ⚰️ Aquí vivía «las dos rutas conviven»: `pareceJs` y `validaPruebaJs` son
// puros y sus pruebas están en `prueba-js.test.ts`.

// EL ESTADO DE UN CONTROL, que no vive ni en el texto ni en el CSS. Entró a la
// vez que `que:"atributo"` en el DSL, para poder medir una ruta contra otra con
// el mismo vocabulario; retirado el DSL, sigue siendo el único verbo que ve
// `disabled` o `aria-expanded`.
describe("`atributoCambiaDe`: el mismo verbo que gano la spec", () => {
  const QUIZ = marco(`
    <button id="opcion">Madrid</button>
    <button id="enviar" disabled>Enviar</button>
    <script>
      document.getElementById('opcion').addEventListener('click', function () {
        document.getElementById('enviar').removeAttribute('disabled');
      });
    </script>`);

  it("ve que el boton deja de estar deshabilitado", async () => {
    const fallos = await correr(QUIZ, `
      const antes = await ui.atributo("#enviar", "disabled");
      await ui.clic("#opcion");
      await ui.atributoCambiaDe("#enviar", "disabled", antes);
    `);
    expect(fallos, `acuso a una pagina correcta: ${JSON.stringify(fallos)}`).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: si sigue deshabilitado, acusa", async () => {
    const rota = QUIZ.replace("removeAttribute('disabled')", "blur()");
    const fallos = await correr(rota, `
      const antes = await ui.atributo("#enviar", "disabled");
      await ui.clic("#opcion");
      await ui.atributoCambiaDe("#enviar", "disabled", antes);
    `);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("disabled");
  }, 60_000);

  // LA OTRA DIRECCIÓN: un atributo que APARECE cuenta igual que uno que se va.
  it("un atributo que aparece también es un cambio", async () => {
    const PANEL = marco(`
      <button id="abrir">Más</button><div id="panel"></div>
      <script>
        document.getElementById('abrir').addEventListener('click', function () {
          document.getElementById('panel').setAttribute('aria-expanded', 'true');
        });
      </script>`);
    const fallos = await correr(PANEL, `
      const antes = await ui.atributo("#panel", "aria-expanded");
      await ui.clic("#abrir");
      await ui.atributoCambiaDe("#panel", "aria-expanded", antes);
    `);
    expect(fallos, JSON.stringify(fallos)).toEqual([]);
  }, 60_000);

  // EL NOMBRE EQUIVOCADO NO SE DISFRAZA DE «no cambió»: decirlo así es lo que
  // separa que el modelo corrija el nombre de que reescriba un script que va.
  it("un atributo que no está ni antes ni después lo dice, y no dice «no cambió»", async () => {
    const fallos = await correr(QUIZ, `
      const antes = await ui.atributo("#enviar", "checked");
      await ui.clic("#opcion");
      await ui.atributoCambiaDe("#enviar", "checked", antes);
    `);
    expect(fallos.length).toBe(1);
    expect(fallos[0]!.mensaje).toContain("ni antes ni después");
    expect(fallos[0]!.mensaje).not.toContain("no cambió");
  }, 60_000);
});

// ─── LA RUTA JS, A LA ALTURA DEL DSL (2026-09-22) ───────────────────────────
//
// Para poder retirar el DSL, sus tres protecciones tenían que existir aquí: el
// censo de clic muerto como precondición de `ui.clic`, `ui.desplaza` para lo
// que se dispara al verse, y `{ cualquiera: true }` para un grupo sin id. Se
// carga en ORIGEN REAL y con el preludio instalado, que es como corre en los
// ojos: con `setContent` el censo no existe y todo sería fail-open.
import { cargarEnOrigenReal } from "@/lib/ai/origen-de-medida";
import { PRELUDIO_CENSO_CLIC } from "./prueba-js";

async function correrReal(html: string, codigo: string, opciones: { propia?: boolean } = {}) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
    await cargarEnOrigenReal(page, html);
    return leerFallos(await page.evaluate(programaJs(codigo, opciones)));
  } finally {
    await browser.close();
  }
}

// Sube AL VERSE y no cablea un solo clic. El relleno lo deja fuera de pantalla
// al cargar, para que el observer no arranque solo.
const SUBE_AL_VERSE = marco(`
  <button id="empezar">Ver cifras</button>
  <div style="height:3000px"></div>
  <p id="numeros">0</p>
  <script>
    new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      document.getElementById("numeros").textContent = "5000";
    }).observe(document.getElementById("numeros"));
  <\/script>`);

// Pestañas creadas con createElement: sin id, que es la familia que más fallaba.
const PESTANAS_SIN_ID = marco(`
  <nav id="nav"></nav><p id="panel">inicio</p>
  <script>
    ["inicio", "servicios"].forEach(function (n) {
      var b = document.createElement("button");
      b.className = "tab";
      b.textContent = n;
      b.addEventListener("click", function () { document.getElementById("panel").textContent = n + "!"; });
      document.getElementById("nav").appendChild(b);
    });
  <\/script>`);

describe("la ruta JS protege como el DSL", () => {
  it("🔴 un clic sin manejador en la promesa DEL TURNO es fallo de la prueba, y nombra ui.desplaza", async () => {
    const fallos = await correrReal(
      SUBE_AL_VERSE,
      'var t = await ui.texto("#numeros"); await ui.clic("#empezar"); await ui.cambiaDe("#numeros", t);',
    );
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toContain('ui.desplaza("#empezar")');
  }, 60_000);

  it("🔴 …y en una promesa GUARDADA es la página que perdió su manejador: la regresión", async () => {
    const fallos = await correrReal(SUBE_AL_VERSE, 'await ui.clic("#empezar");', { propia: false });
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
    expect(fallos[0]!.mensaje).toContain("ya no tiene manejador");
  }, 60_000);

  it("🔴 ui.desplaza arranca lo que se dispara al verse", async () => {
    const fallos = await correrReal(
      SUBE_AL_VERSE,
      'var t = await ui.texto("#numeros"); await ui.desplaza("#numeros"); await ui.cambiaDe("#numeros", t);',
    );
    expect(fallos).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: sin desplazar no cambia, así que la promesa no pasa de gratis", async () => {
    const fallos = await correrReal(
      SUBE_AL_VERSE,
      'var t = await ui.texto("#numeros"); await ui.espera(200); await ui.cambiaDe("#numeros", t);',
    );
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBeUndefined();
  }, 60_000);

  it("🔴 un grupo sin id se pulsa declarando que da igual cuál", async () => {
    const fallos = await correrReal(
      PESTANAS_SIN_ID,
      'var t = await ui.texto("#panel"); await ui.clic(".tab", 1, { cualquiera: true }); await ui.cambiaDe("#panel", t);',
    );
    expect(fallos).toEqual([]);
  }, 60_000);

  it("…y sin declararlo no se adivina: se dicen las dos salidas", async () => {
    const fallos = await correrReal(PESTANAS_SIN_ID, 'await ui.clic(".tab");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toMatch(/Afina el selector/);
    expect(fallos[0]!.mensaje).toContain("cualquiera: true");
  }, 60_000);

  it("CONTRA-PRUEBA: la delegación en document cuenta — el guardia del programa no la tapa ni la inventa", async () => {
    const DELEGADO = marco(`
      <button id="suelto">x</button><p id="panel">antes</p>
      <script>
        document.addEventListener("click", function (e) {
          if (e.target.id === "suelto") document.getElementById("panel").textContent = "despues";
        });
      </script>`);
    const fallos = await correrReal(DELEGADO, 'await ui.clic("#suelto"); await ui.es("#panel", "despues");');
    expect(fallos).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: un botón con manejador no lo toca el censo", async () => {
    const fallos = await correrReal(
      PESTANAS_SIN_ID.replace('<nav id="nav"></nav>', '<nav id="nav"></nav><button id="solo">x</button>')
        .replace("<\/script>", 'document.getElementById("solo").addEventListener("click", function () { document.getElementById("panel").textContent = "solo"; });<\/script>'),
      'await ui.clic("#solo"); await ui.es("#panel", "solo");',
    );
    expect(fallos).toEqual([]);
  }, 60_000);
});

// ─── LA MIGRACIÓN SIGUE COMPROBANDO LO MISMO ────────────────────────────────
//
// Una guardada en DSL pasa a JS con `pasosAJs`. Si la conversión cambiara lo
// que la promesa comprueba, la suite migrada acusaría (o callaría) distinto que
// la que se guardó. Mientras existió el DSL se corrían LAS DOS sobre la misma
// página y se comparaban, y daban lo mismo. Retirado su motor (2026-09-22),
// queda fijado el veredicto que daba la original: en la página que funciona
// se cumple, y en la que se rompió acusa a la PÁGINA, no a la prueba.
import { pasosAJs, type PasoSpec } from "./pruebas-de-la-pagina";

const CARRITO = (manejador: string) => marco(`
  <button id="agregar">Añadir</button><b id="total">0 €</b>
  <script>
    document.getElementById("agregar").addEventListener("click", function () { ${manejador} });
  <\/script>`);
const SUMA = 'var t = document.getElementById("total"); t.textContent = (parseInt(t.textContent) + 5) + " €";';
const PASOS_CARRITO: readonly PasoSpec[] = [
  { clic: "#agregar", veces: 1, entonces: [{ donde: "#total", que: "cambia" }] },
];

describe("pasosAJs: la promesa migrada da el veredicto de la original", () => {
  it("🔴 en la página que funciona, se cumple", async () => {
    expect(await correrReal(CARRITO(SUMA), pasosAJs(PASOS_CARRITO)!)).toEqual([]);
  }, 60_000);

  it("🔴 en la que se rompió, falla acusando a la página", async () => {
    const js = await correrReal(CARRITO(""), pasosAJs(PASOS_CARRITO)!);
    expect(js).toHaveLength(1);
    expect(js[0]!.deLaPrueba).toBeUndefined();
  }, 60_000);

  it("🔴 con desplazar y grupo: lo que se dispara al verse y los botones sin id", async () => {
    const js1 = pasosAJs([{ desplaza: "#numeros", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] }])!;
    expect(await correrReal(SUBE_AL_VERSE, js1)).toEqual([]);
    const js2 = pasosAJs([{ clic: ".tab", cualquiera: true, veces: 1, entonces: [{ donde: "#panel", que: "cambia" }] }])!;
    expect(await correrReal(PESTANAS_SIN_ID, js2)).toEqual([]);
  }, 60_000);
});

// ─── POR SU TEXTO, como el DSL ──────────────────────────────────────────────
// Sin esto una guardada migrada que pulsara por texto diría «no es CSS válido»
// y se RETIRARÍA de la suite en su primera pasada.
describe("ui.clic por el texto del botón", () => {
  const CON_TEXTO = marco(`
    <p id="panel">antes</p>
    <script>
      var b = document.createElement("button");
      b.textContent = "Añadir al carrito";
      b.addEventListener("click", function () { document.getElementById("panel").textContent = "dentro"; });
      document.body.appendChild(b);
    <\/script>`);

  it("🔴 un botón sin id se pulsa por su texto", async () => {
    const fallos = await correrReal(CON_TEXTO, 'await ui.clic("Añadir al carrito"); await ui.es("#panel", "dentro");');
    expect(fallos).toEqual([]);
  }, 60_000);

  it("…y un texto que no existe es fallo de la prueba, no de la página", async () => {
    const fallos = await correrReal(CON_TEXTO, 'await ui.clic("Comprar ya");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toMatch(/nada pulsable que se llame así/);
  }, 60_000);

  it("🔴 la guardada migrada que pulsaba por texto sigue cumpliéndose", async () => {
    const js = pasosAJs([{ clic: "Añadir al carrito", veces: 1, entonces: [{ donde: "#panel", que: "cambia" }] }])!;
    expect(await correrReal(CON_TEXTO, js)).toEqual([]);
  }, 60_000);

  it("le da igual la caja y los espacios de más", async () => {
    const fallos = await correrReal(CON_TEXTO, 'await ui.clic("  añadir AL carrito "); await ui.es("#panel", "dentro");');
    expect(fallos, JSON.stringify(fallos)).toEqual([]);
  }, 60_000);

  // Un nombre que señala a varios NO se resuelve por descarte: pulsar «el
  // primero que aparezca» convertiría una promesa ambigua en una que pasa por
  // suerte. Y no acusa a la página: es la prueba la que no señala a uno.
  it("🔴 CONTRA-PRUEBA: un nombre que casa con varios botones visibles no vale", async () => {
    const tres = marco(`
      <button type="button" class="btn-add">Añadir</button>
      <button type="button" class="btn-add">Añadir</button>
      <button type="button" class="btn-add">Añadir</button>
      <b id="total">0</b>`);
    const fallos = await correr(tres, 'await ui.clic("Añadir");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toMatch(/señala 3/);
  }, 60_000);
});

// ─── LO QUE FIJABAN LAS PRUEBAS DEL DSL, AHORA SOBRE LA RUTA JS (2026-09-22) ──
//
// Al retirar el DSL se borraron sus cuatro ficheros de prueba. Cada protección
// que fijaban y que la ruta JS no tenía probada se porta aquí, con su brazo de
// control. Las protecciones vivían ya en los primitivos `ui.*`; lo que faltaba
// era la prueba que las sujete.
describe("el censo de clic, fila por fila", () => {
  const PROMESA = 'var t = await ui.texto("#numeros"); await ui.clic("#empezar"); await ui.cambiaDe("#numeros", t);';

  it("🔴 CONTROL: un botón vivo por la propiedad `.onclick` no se acusa", async () => {
    const porPropiedad = marco(`
      <button id="empezar">+1</button><p id="numeros">0</p>
      <script>
        document.getElementById("empezar").onclick = function () {
          document.getElementById("numeros").textContent = "1";
        };
      <\/script>`);
    expect(await correrReal(porPropiedad, PROMESA)).toEqual([]);
  }, 60_000);

  // FAIL-OPEN, la regla del censo desde que existe: sin el preludio no se
  // acusa a nadie. El botón está muerto y el número sube SOLO; sin censo no hay
  // con qué saberlo, y no medir no es medir mal.
  it("🔴 sin el preludio instalado, la precondición se calla del todo", async () => {
    const subeSolo = marco(`
      <p id="numeros">0</p><button id="empezar">Ver cifras</button>
      <script>
        setTimeout(function () { document.getElementById("numeros").textContent = "400"; }, 800);
      <\/script>`);
    expect(await correr(subeSolo, PROMESA)).toEqual([]);
    // CONTROL: con el preludio, el mismo botón muerto sí se dice antes de pulsar.
    const conCenso = await correrReal(subeSolo, PROMESA);
    expect(conCenso).toHaveLength(1);
    expect(conCenso[0]!.deLaPrueba).toBe(true);
  }, 90_000);

  // La anatomía de un mensaje de herramienta: el HECHO, ni una palabra sobre
  // el sujeto, el arreglo NOMBRADO, y lo que ya se comprobó dicho al final para
  // que nadie lo busque otra vez.
  it("🔴 el mensaje cuenta el hecho, nombra el arreglo y dice lo que ya se miró", async () => {
    const fallos = await correrReal(SUBE_AL_VERSE, 'await ui.clic("#empezar");');
    const m = fallos[0]!.mensaje;
    expect(m).toContain("#empezar");
    expect(m).toContain("manejador de clic");
    expect(m).toContain('ui.desplaza("#empezar")');
    expect(m).not.toMatch(/página|pagina/i);
    expect(m).toContain("(note:");
    expect(m).toMatch(/onclick/);
    expect(m).toMatch(/document/);
    expect(m, "mayúsculas enfáticas en un mensaje de herramienta").not.toMatch(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/);
  }, 60_000);

  // 🔴 Y POR EL CAMINO DEL CHAT (2026-09-22). `ai-design` corre la prueba con
  // `renderVisualQualityViewports`, que no instalaba el censo: el mismo botón
  // muerto salía como «no cambió», acusando a la página de lo que era de la
  // prueba. La precondición viaja ahora con el programa, lo corra quien lo corra.
  it("🔴 por el renderizador del Chat el clic muerto también se dice antes de pulsar", async () => {
    const r = await renderVisualQualityViewports(SUBE_AL_VERSE, {}, {
      behaviorProgram: programaJs(PROMESA),
    });
    const fallos = leerFallos(r?.behaviorResult);
    expect(fallos, JSON.stringify(fallos)).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toContain("no tiene manejador");
  }, 90_000);

  // 🔴 EL RECORTE NO SE COME EL ARREGLO. `leerFallos` acota el mensaje, y el
  // del clic muerto cita el selector dos veces. Recortar el selector DENTRO del
  // arreglo le daría al modelo uno que no existe. Ver `TOPE_MENSAJE`.
  it("🔴 con un selector largo, el arreglo llega ENTERO", async () => {
    const clase = "b".repeat(149);
    const sel = `.${clase}`;
    const largo = marco(`<button class="${clase}">Ver</button>`);
    const fallos = await correrReal(largo, `await ui.clic(${JSON.stringify(sel)});`);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain(`ui.desplaza("${sel}")`);
  }, 60_000);
});

describe("el selector se cuenta en el navegador, no se adivina", () => {
  const LISTA = marco(`
    <ul id="lista">
      <li class="fila">uno</li><li class="fila">dos</li><li class="fila" id="tres">tres</li>
    </ul>
    <button id="marcar">marcar</button>
    <script>
      document.getElementById('marcar').addEventListener('click', function () {
        document.getElementById('tres').textContent = 'TRES marcado';
      });
    <\/script>`);

  // La forma estándar de señalar UN elemento entre hermanos: la regex que la
  // tiraba se retiró el 2026-09-04.
  it("un `:nth-child` señala uno y la prueba corre", async () => {
    const fallos = await correr(LISTA, 'await ui.clic("#marcar"); await ui.contiene("#lista .fila:nth-child(3)", "marcado");');
    expect(fallos, JSON.stringify(fallos)).toEqual([]);
  }, 60_000);

  it("uno que no existe es fallo DE LA PRUEBA: la página no puede fallar lo que no se señala", async () => {
    const fallos = await correr(LISTA, 'await ui.clic("#marcar"); await ui.contiene("#noExiste", "x");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
  }, 60_000);

  // Un selector que no es CSS se busca como NOMBRE —el modelo escribe «Añadir
  // al carrito» más a menudo que un selector válido—, y si tampoco hay nada
  // que se llame así lo dice con las DOS cosas que se intentaron.
  it("uno que ni siquiera es CSS no revienta, y no acusa a la página", async () => {
    const fallos = await correr(LISTA, 'await ui.clic("((");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.deLaPrueba).toBe(true);
    expect(fallos[0]!.mensaje).toMatch(/ni existe el selector.*ni hay nada pulsable/);
  }, 60_000);
});

// LOS DOS FALLOS DE LA CORRIDA DEL 2026-09-04, y son el mismo: dos páginas
// acusadas de no enseñar su mensaje de éxito que lo tenían bien cableado. La
// prueba pulsaba «enviar» SIN RELLENAR los `required`, el navegador bloqueaba y
// el `submit` no llegaba nunca. Las dos mitades: que el olvido se ve, y que
// rellenar antes —lo que dice el prompt— lo arregla.
describe("un formulario con `required` se rellena antes de enviarlo", () => {
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
    <\/script>`);

  it("sin rellenar, el navegador bloquea el envío y la promesa no se cumple", async () => {
    const fallos = await correr(OBLIGATORIO, 'await ui.clic("#enviar"); await ui.visible("#exito");');
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("#exito");
  }, 60_000);

  it("rellenándolo con ui.escribe, la promesa se cumple", async () => {
    const fallos = await correr(
      OBLIGATORIO,
      'await ui.escribe("#nombre", "Ana"); await ui.escribe("#email", "ana@ejemplo.com"); await ui.clic("#enviar"); await ui.visible("#exito");',
    );
    expect(fallos, JSON.stringify(fallos)).toEqual([]);
  }, 60_000);
});

// `cualquiera` autoriza a pulsar uno del grupo; no vuelve verde lo que está
// roto. Sin censo es la página la que no cumplió; con censo se dice antes.
describe("el grupo declarado no salva a un grupo muerto", () => {
  const MUERTOS = marco(`<button class="add">Uno</button><button class="add">Dos</button><div id="total">0</div>`);
  const PROMESA = 'var t = await ui.texto("#total"); await ui.clic(".add", 1, { cualquiera: true }); await ui.cambiaDe("#total", t);';

  it("CONTRA-PRUEBA: con botones MUERTOS, `cualquiera` no salva la promesa", async () => {
    const sinCenso = await correr(MUERTOS, PROMESA);
    expect(sinCenso).toHaveLength(1);
    expect(sinCenso[0]!.deLaPrueba).toBeUndefined();
    const conCenso = await correrReal(MUERTOS, PROMESA);
    expect(conCenso).toHaveLength(1);
    expect(conCenso[0]!.mensaje).toContain("no tiene manejador");
  }, 90_000);
});

// 🔴 EL FALLO QUE `estiloCambiaDe` EXISTE PARA VER, con sus dos brazos: el
// script pone la clase y el CSS la define o no. Las dos páginas son idénticas
// salvo por una regla de CSS.
describe("`estiloCambiaDe` con el CSS del estado y con un nombre que no existe", () => {
  const TEMA = (conCss: boolean) => `<!doctype html><html><head><meta charset="utf-8"><style>
body { background: #ffffff; }
${conCss ? "body.oscuro { background: #101014; }" : ""}
</style></head><body>
<p id="titulo">Mi Negocio</p><button id="tema">tema</button>
<script>document.getElementById("tema").addEventListener("click", function () {
  document.body.classList.toggle("oscuro");
});<\/script></body></html>`;
  const PROMESA = (prop: string) =>
    `var b = await ui.estilo("body", ${JSON.stringify(prop)}); await ui.clic("#tema"); await ui.estiloCambiaDe("body", ${JSON.stringify(prop)}, b);`;

  it("ve el cambio de aspecto cuando el CSS del estado SÍ existe", async () => {
    const fallos = await correr(TEMA(true), PROMESA("background-color"));
    expect(fallos, JSON.stringify(fallos)).toEqual([]);
  }, 60_000);

  // Y la razón de que exista, dejada escrita para que nadie lo borre por
  // redundante: comprobado como se podía antes, el control mudo pasa.
  it("`visible` no ve el control mudo — por eso hace falta `estiloCambiaDe`", async () => {
    const fallos = await correr(TEMA(false), 'await ui.clic("#tema"); await ui.visible("body");');
    expect(fallos).toEqual([]);
  }, 60_000);

  it("un nombre de propiedad que el navegador no conoce se dice como tal, no como «no cambió»", async () => {
    const fallos = await correr(TEMA(true), PROMESA("--no-existe"));
    expect(fallos).toHaveLength(1);
    expect(fallos[0]!.mensaje).toContain("no tiene la propiedad");
  }, 60_000);
});

// LA VENTANA SÓLO LA PAGA LA AFIRMACIÓN QUE FALLA. Tres que se cumplen al
// instante, midiendo sólo el programa —sin el arranque del navegador—: si cada
// una esperase su ventana entera, serían más de cuatro segundos.
describe("la ventana de espera", () => {
  it("sale en cuanto se cumple: lo que pasa al instante no paga la ventana", async () => {
    const INSTANTE = marco(`<p id="r">a</p><button id="b">x</button>
      <script>document.getElementById("b").addEventListener("click", function () {
        document.getElementById("r").textContent = "b";
      });<\/script>`);
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(INSTANTE, { waitUntil: "domcontentloaded" });
      const t0 = Date.now();
      const bruto = await page.evaluate(
        programaJs('await ui.clic("#b"); await ui.es("#r", "b"); await ui.contiene("#r", "b"); await ui.visible("#r");'),
      );
      const ms = Date.now() - t0;
      expect(leerFallos(bruto)).toEqual([]);
      expect(ms, `el programa tardó ${ms} ms`).toBeLessThan(VENTANA_PRUEBA_MS);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

// ─── EL BRAZO SIN ACCIONES (2026-09-22) ─────────────────────────────────────
//
// La misma promesa con sus acciones anuladas: lo que se cumple igual no dice
// nada de lo que hizo el modelo. Es la medida de un eval con brazo de control,
// y la pide la batería, no el turno. Cada caso lleva su contraprueba: la promesa
// que SÍ depende de la acción no sale como vacua.
async function sinAcciones(html: string, codigo: string) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return leerVacuas(await page.evaluate(programaSinAccionesJs(codigo)));
  } finally {
    await browser.close();
  }
}

// Llega SOLO a «5,000» poco después de cargar, y el botón está VIVO: el censo
// no tiene nada que decir, y la promesa sale verde la pulse quien la pulse.
const LLEGA_SOLO = marco(`
  <button id="ver">Ver</button><p id="n">0</p>
  <script>
    document.getElementById("ver").addEventListener("click", function () {});
    setTimeout(function () { document.getElementById("n").textContent = "5,000"; }, 700);
  <\/script>`);
// Aquí sólo el clic lo mueve.
const SOLO_EL_CLIC = marco(`
  <button id="ver">Ver</button><p id="n">0</p>
  <script>
    document.getElementById("ver").addEventListener("click", function () {
      document.getElementById("n").textContent = "5,000";
    });
  <\/script>`);

describe("el brazo sin acciones: ¿discrimina la promesa?", () => {
  it("🔴 una afirmación que se cumple sola no dice nada de la acción", async () => {
    const codigo = 'await ui.clic("#ver"); await ui.contiene("#n", "5,000");';
    // Con sus acciones sale VERDE: por eso hace falta el otro brazo.
    expect(await correr(LLEGA_SOLO, codigo)).toEqual([]);
    const v = await sinAcciones(LLEGA_SOLO, codigo);
    expect(v).toHaveLength(1);
    expect(v[0]!.mensaje).toContain('ui.contiene("#n", "5,000")');
    expect(v[0]!.mensaje).toContain("sin tus acciones");
  }, 60_000);

  // Guardar el antes y comparar protege de lo que YA estaba, no de lo que se
  // mueve solo. El brazo ve las dos cosas.
  it("🔴 comparar con el antes tampoco basta si algo lo mueve solo", async () => {
    const codigo = 'var t = await ui.texto("#n"); await ui.clic("#ver"); await ui.cambiaDe("#n", t);';
    const v = await sinAcciones(LLEGA_SOLO, codigo);
    expect(v).toHaveLength(1);
    expect(v[0]!.mensaje).toContain("ui.cambiaDe");
  }, 60_000);

  it("CONTRA-PRUEBA: lo que sólo mueve la acción SÍ discrimina", async () => {
    const codigo =
      'var t = await ui.texto("#n"); await ui.clic("#ver"); await ui.cambiaDe("#n", t); await ui.contiene("#n", "5,000");';
    expect(await correr(SOLO_EL_CLIC, codigo)).toEqual([]);
    expect(await sinAcciones(SOLO_EL_CLIC, codigo)).toEqual([]);
  }, 60_000);

  // Sus dos brazos son el MISMO programa: comparar no mide nada, y se dice así
  // en vez de contar sus afirmaciones una a una.
  it("🔴 una promesa que no pide ninguna acción no mide la conducta", async () => {
    const v = await sinAcciones(SOLO_EL_CLIC, 'await ui.visible("#n"); await ui.contiene("#n", "0");');
    expect(v).toHaveLength(1);
    expect(v[0]!.mensaje).toMatch(/no pide ninguna acción/);
  }, 60_000);

  it("el brazo de la batería mide sobre la página cargada de verdad", async () => {
    const v = await brazoSinAcciones(LLEGA_SOLO, 'await ui.clic("#ver"); await ui.contiene("#n", "5,000");');
    expect(v).toHaveLength(1);
    expect(await brazoSinAcciones(SOLO_EL_CLIC, 'await ui.clic("#ver"); await ui.contiene("#n", "5,000");')).toEqual([]);
  }, 90_000);
});
