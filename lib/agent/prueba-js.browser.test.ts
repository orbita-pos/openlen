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
import { programaJs, pareceJs, validaPruebaJs } from "./prueba-js";
import { leerFallos } from "./behavior-spec";

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

describe("las dos rutas conviven — se decide por la forma del contenido", () => {
  it("un JSON sigue leyéndose como spec, y un programa como JS", () => {
    expect(pareceJs('[{"clic":"#a","entonces":[]}]')).toBe(false);
    expect(pareceJs('await ui.clic("#a");')).toBe(true);
    expect(pareceJs("   ")).toBe(false);
  });

  it("la validación de entrada es de TAMAÑO, no de sintaxis", () => {
    expect(validaPruebaJs("await ui.clic('#a');").ok).toBe(true);
    expect(validaPruebaJs("   ")).toEqual({ ok: false, reason: "vacia" });
    expect(validaPruebaJs("x".repeat(5000))).toEqual({ ok: false, reason: "demasiado_grande" });
  });
});

// PARIDAD DE VOCABULARIO ENTRE LAS DOS RUTAS, y no es un capricho.
//
// A existe para poder MEDIRLA contra B sobre el mismo conjunto. Si B gana un
// verbo que A no tiene, la corrida compara el verbo y no las rutas — mediria
// otra cosa creyendo que mide esta. Por eso `atributoCambiaDe` entra a la vez
// que `que:"atributo"`, aunque A siga apagada tras `OPENLEN_PRUEBA_JS=1`.
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
});

// ─── LA RUTA JS, A LA ALTURA DEL DSL (2026-09-22) ───────────────────────────
//
// Para poder retirar el DSL, sus tres protecciones tenían que existir aquí: el
// censo de clic muerto como precondición de `ui.clic`, `ui.desplaza` para lo
// que se dispara al verse, y `{ cualquiera: true }` para un grupo sin id. Se
// carga en ORIGEN REAL y con el preludio instalado, que es como corre en los
// ojos: con `setContent` el censo no existe y todo sería fail-open.
import { cargarEnOrigenReal } from "@/lib/ai/origen-de-medida";
import { PRELUDIO_CENSO_CLIC } from "./behavior-spec";

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

// ─── LA MIGRACIÓN DICE LO MISMO QUE EL ORIGINAL ─────────────────────────────
//
// Una guardada en DSL pasa a JS con `pasosAJs`. Si la conversión cambiara lo
// que la promesa comprueba, la suite migrada acusaría (o callaría) distinto que
// la que se guardó. Se corren LAS DOS en Chromium sobre la misma página.
import { pasosAJs } from "./pruebas-de-la-pagina";
import { specProgram, type PasoSpec } from "./behavior-spec";

async function correrDsl(html: string, pasos: readonly PasoSpec[]) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(PRELUDIO_CENSO_CLIC);
    await cargarEnOrigenReal(page, html);
    return leerFallos(await page.evaluate(specProgram(pasos)));
  } finally {
    await browser.close();
  }
}

const CARRITO = (manejador: string) => marco(`
  <button id="agregar">Añadir</button><b id="total">0 €</b>
  <script>
    document.getElementById("agregar").addEventListener("click", function () { ${manejador} });
  <\/script>`);
const SUMA = 'var t = document.getElementById("total"); t.textContent = (parseInt(t.textContent) + 5) + " €";';
const PASOS_CARRITO: readonly PasoSpec[] = [
  { clic: "#agregar", veces: 1, entonces: [{ donde: "#total", que: "cambia" }] },
];

describe("pasosAJs: la promesa migrada dice lo mismo que la original", () => {
  it("🔴 en la página que funciona, las dos se cumplen", async () => {
    expect(await correrDsl(CARRITO(SUMA), PASOS_CARRITO)).toEqual([]);
    expect(await correrReal(CARRITO(SUMA), pasosAJs(PASOS_CARRITO)!)).toEqual([]);
  }, 60_000);

  it("🔴 en la que se rompió, las dos fallan acusando a la página", async () => {
    const dsl = await correrDsl(CARRITO(""), PASOS_CARRITO);
    const js = await correrReal(CARRITO(""), pasosAJs(PASOS_CARRITO)!);
    expect(dsl).toHaveLength(1);
    expect(js).toHaveLength(1);
    expect(dsl[0]!.deLaPrueba).toBeUndefined();
    expect(js[0]!.deLaPrueba).toBeUndefined();
  }, 60_000);

  it("🔴 con desplazar y grupo: lo que se dispara al verse y los botones sin id", async () => {
    const js1 = pasosAJs([{ desplaza: "#numeros", veces: 1, entonces: [{ donde: "#numeros", que: "cambia" }] }])!;
    expect(await correrReal(SUBE_AL_VERSE, js1)).toEqual([]);
    const js2 = pasosAJs([{ clic: ".tab", cualquiera: true, veces: 1, entonces: [{ donde: "#panel", que: "cambia" }] }])!;
    expect(await correrReal(PESTANAS_SIN_ID, js2)).toEqual([]);
  }, 60_000);
});
